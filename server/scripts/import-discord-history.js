import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { summarizeHistoricalMessages } from '../src/core/historical-trade-parser.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(currentDir, '../data/stockrocks-last-month.json');
const sourceBuffer = await fs.readFile(sourcePath);
const sourceHash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');
const source = JSON.parse(sourceBuffer.toString('utf8'));
const analysis = summarizeHistoricalMessages(source.messages);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query('begin');
  const existing = await client.query('select id, status, details from discord_history_imports where source_file_hash=$1', [sourceHash]);
  if (existing.rowCount) {
    await client.query('rollback');
    console.log(JSON.stringify({ idempotent: true, importId: existing.rows[0].id, status: existing.rows[0].status, details: existing.rows[0].details }, null, 2));
    process.exitCode = 0;
  } else {
    const importResult = await client.query(
      `insert into discord_history_imports
       (source_label, source_file_hash, period_start, period_end, status, fetched_count, details)
       values ($1,$2,$3,$4,'running',$5,$6) returning id`,
      ['StockRocks 赵哥whop one-month backfill', sourceHash, source.period.start, source.period.end, source.messages.length,
        { parserVersion: 'history-rules-v1', sourceFetchedAt: source.fetchedAt }]
    );
    const importId = importResult.rows[0].id;
    const eventIds = new Map();

    for (const message of source.messages) {
      const inserted = await client.query(
        `insert into discord_message_events
         (discord_message_id,event_type,guild_id,channel_id,author_id,content,discord_created_at,received_at,raw_payload,
          ingestion_mode,history_import_id,source_fetched_at)
         values ($1,'create',$2,$3,$4,$5,$6,$7,$8,'historical_backfill',$9,$7)
         on conflict (discord_message_id) where event_type='create' and discord_message_id is not null do nothing
         returning id`,
        [message.messageId, message.guildId, message.channelId, message.authorId, message.content, message.timestamp,
          source.fetchedAt, message, importId]
      );
      let eventId = inserted.rows[0]?.id;
      if (!eventId) {
        const found = await client.query("select id from discord_message_events where discord_message_id=$1 and event_type='create'", [message.messageId]);
        eventId = found.rows[0].id;
      }
      eventIds.set(message.messageId, eventId);
    }

    for (const row of analysis.rows) {
      const reviewStatus = row.duplicateOf ? 'excluded_duplicate' : row.reviewStatus;
      const analysisIncluded = row.closedLeg && !row.duplicateOf && reviewStatus === 'auto_included';
      await client.query(
        `insert into strategy_trade_legs
         (message_event_id,leg_index,parser_version,extraction_method,action,symbol,entry_price,exit_price,
          position_fraction,is_closed_leg,gross_return_pct,outcome,confidence,review_status,analysis_included,
          duplicate_of_message_id,notes,occurred_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         on conflict (message_event_id,leg_index,parser_version) do nothing`,
        [eventIds.get(row.message.messageId), row.legIndex, row.parserVersion, row.extractionMethod, row.action, row.symbol,
          row.entryPrice, row.exitPrice, row.positionFraction, row.closedLeg, row.grossReturnPct, row.outcome, row.confidence,
          reviewStatus, analysisIncluded, row.duplicateOf, row.notes, row.message.timestamp]
      );
    }

    const details = { ...analysis.metrics, parserVersion: 'history-rules-v1', definition: 'wins / (wins + losses + flats)' };
    await client.query(
      `update discord_history_imports set status='completed', imported_count=$1, details=$2, completed_at=now() where id=$3`,
      [source.messages.length, details, importId]
    );
    await client.query('commit');
    console.log(JSON.stringify({ idempotent: false, importId, details }, null, 2));
  }
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}
