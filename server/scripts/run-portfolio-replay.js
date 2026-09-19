import 'dotenv/config';
import pg from 'pg';
import { replayPortfolio } from '../src/core/portfolio-replay.js';
import { LongbridgeQuoteService } from '../src/services/longbridge-quotes.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const rowsToReplayInput = (rows) => rows.map((row) => ({
  id: row.id,
  messageEventId: row.message_event_id,
  legIndex: row.leg_index,
  action: row.action,
  symbol: row.symbol,
  entryPrice: row.entry_price,
  exitPrice: row.exit_price,
  positionFraction: row.position_fraction,
  reviewStatus: row.review_status,
  duplicateOriginalAt: row.duplicate_original_at,
  occurredAt: row.occurred_at,
  content: row.content
}));

function latestTradablePrice(quote) {
  const sessions = [quote.preMarket, quote.postMarket, quote.overnight]
    .filter((item) => item?.timestamp && Number.isFinite(Number(item.last)))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return Number(sessions[0]?.last ?? quote.last);
}

async function fetchMarks(symbols) {
  const service = new LongbridgeQuoteService({ ttlMs: 0 });
  const marks = {};
  const failures = [];
  for (let index = 0; index < symbols.length; index += 20) {
    const batch = symbols.slice(index, index + 20);
    try {
      const result = await service.getQuotes(batch);
      for (const quote of result.quotes) {
        const price = latestTradablePrice(quote);
        if (Number.isFinite(price) && price > 0) marks[quote.symbol] = price;
      }
    } catch {
      for (const symbol of batch) {
        try {
          const result = await service.getQuotes([symbol]);
          const quote = result.quotes[0];
          const price = quote && latestTradablePrice(quote);
          if (Number.isFinite(price) && price > 0) marks[symbol] = price;
          else failures.push(symbol);
        } catch { failures.push(symbol); }
      }
    }
  }
  return { marks, failures };
}

const history = await pool.query("select * from discord_history_imports where status='completed' order by completed_at desc limit 1");
if (!history.rowCount) throw new Error('No completed Discord history import found');
const importRow = history.rows[0];
const legs = await pool.query(`
  select l.*, m.content, orig.discord_created_at as duplicate_original_at
  from strategy_trade_legs l
  join discord_message_events m on m.id = l.message_event_id
  left join discord_message_events orig
    on orig.discord_message_id = l.duplicate_of_message_id and orig.event_type = 'create'
  where l.occurred_at between $1 and $2
  order by l.occurred_at, l.leg_index`, [importRow.period_start, importRow.period_end]);

const input = rowsToReplayInput(legs.rows);
const preliminary = replayPortfolio(input);
const { marks, failures } = await fetchMarks(preliminary.positions.map((position) => position.symbol));
const result = replayPortfolio(input, { finalQuotes: marks, finalQuoteTime: new Date().toISOString() });

const client = await pool.connect();
let runId;
try {
  await client.query('begin');
  const inserted = await client.query(`insert into strategy_replay_runs
    (history_import_id,strategy_version,status,period_start,period_end,initial_capital,final_equity,cash,market_value,
     realized_pnl,unrealized_pnl,total_return_pct,max_drawdown_pct,peak_utilization_pct,assumptions,metrics,completed_at)
    values ($1,$2,'completed',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()) returning id`, [
    importRow.id, result.strategyVersion, importRow.period_start, importRow.period_end,
    result.summary.initialCapital, result.summary.finalEquity, result.summary.cash, result.summary.marketValue,
    result.summary.realizedPnl, result.summary.unrealizedPnl, result.summary.totalReturnPct,
    result.summary.maxDrawdownPct, result.summary.peakUtilizationPct,
    result.assumptions, { ...result.summary, quoteFailures: failures, longbridgeMarks: Object.keys(marks).length }
  ]);
  runId = inserted.rows[0].id;

  for (let index = 0; index < result.events.length; index += 1) {
    const event = result.events[index];
    await client.query(`insert into strategy_replay_events
      (run_id,sequence,trade_leg_id,message_event_id,occurred_at,side,symbol,quantity,signal_price,fill_price,fees,
       realized_pnl,cash_after,equity_after,utilization_pct,status,reason)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
      runId, index + 1, event.tradeLegId, event.messageEventId, event.occurredAt, event.side, event.symbol,
      event.quantity || 0, event.signalPrice, event.fillPrice, event.fees || 0, event.realizedPnl || 0,
      event.cashAfter, event.equityAfter, event.utilizationPct, event.status, event.reason
    ]);
  }

  for (const item of result.snapshots) {
    await client.query(`insert into strategy_replay_snapshots
      (run_id,sequence,occurred_at,cash,market_value,equity,return_pct,drawdown_pct,event_side,event_symbol,mark_source)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [runId, item.sequence, item.occurredAt,
      item.cash, item.marketValue, item.equity, item.returnPct, item.drawdownPct,
      item.event?.side || null, item.event?.symbol || null, item.markSource || null]);
  }

  for (const position of result.positions) {
    await client.query(`insert into strategy_replay_positions
      (run_id,symbol,quantity,average_cost,mark_price,market_value,unrealized_pnl,mark_source)
      values ($1,$2,$3,$4,$5,$6,$7,$8)`, [runId, position.symbol, position.quantity, position.averageCost,
      position.markPrice, position.marketValue, position.unrealizedPnl, position.markSource]);
  }
  await client.query('commit');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}

console.log(JSON.stringify({ runId, strategyVersion: result.strategyVersion, summary: result.summary, quoteFailures: failures, positions: result.positions }, null, 2));
