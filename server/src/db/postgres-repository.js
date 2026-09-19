import pg from 'pg';
import { normalizeZhaoMessage, parseHistoricalTradeMessage } from '../core/historical-trade-parser.js';

const nullableNumber = (value) => value == null ? null : Number(value);
const iso = (value) => value == null ? null : new Date(value).toISOString();

export function mapPostgresMessage(row) {
  return {
    id: row.id,
    recordedAt: iso(row.received_at),
    eventType: row.event_type,
    messageId: row.discord_message_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    authorId: row.author_id,
    content: row.content,
    discordCreatedAt: iso(row.discord_created_at),
    rawPayload: row.raw_payload || {}
  };
}

export function mapPostgresSignal(row) {
  const payload = row.parsed_payload || {};
  return {
    id: row.id,
    status: row.status,
    createdAt: iso(row.created_at),
    parser: payload.parser || row.parser_version,
    rawText: payload.rawText || null,
    symbol: row.symbol,
    action: row.action,
    price: nullableNumber(row.reference_price),
    fraction: nullableNumber(row.position_fraction),
    stopPrice: nullableNumber(row.stop_price),
    conditional: row.is_conditional,
    ambiguous: Boolean(payload.ambiguous),
    confidence: Number(row.confidence),
    executable: row.is_executable,
    reasons: row.reasons || [],
    messageEventId: row.message_event_id,
    risk: payload.risk || null
  };
}

export function mapPostgresPosition(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    quantity: Number(row.quantity),
    averageCost: nullableNumber(row.average_cost),
    lastPrice: nullableNumber(row.last_price),
    marketValue: Number(row.market_value),
    unrealizedPnl: nullableNumber(row.unrealized_pnl),
    realizedPnl: nullableNumber(row.realized_pnl),
    capturedAt: iso(row.captured_at)
  };
}

function mapPostgresPortfolio(row, positions) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    baseCurrency: row.base_currency,
    initialCapital: Number(row.initial_capital),
    cash: Number(row.current_cash),
    equity: Number(row.current_equity),
    realizedPnl: positions.reduce((sum, item) => sum + (item.realizedPnl || 0), 0),
    maxGrossUtilization: Number(row.max_gross_utilization),
    maxSymbolWeight: Number(row.max_symbol_weight),
    minCashReserve: Number(row.min_cash_reserve),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    positions
  };
}

function mapPostgresAudit(row) {
  return {
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: row.details || {},
    createdAt: iso(row.created_at)
  };
}

function summarizeLegRows(legRows) {
  const included = legRows.filter((row) => row.analysis_included);
  const wins = included.filter((row) => row.outcome === 'win').length;
  const losses = included.filter((row) => row.outcome === 'loss').length;
  const flats = included.filter((row) => row.outcome === 'flat').length;
  const returns = included.map((row) => Number(row.gross_return_pct)).sort((a, b) => a - b);
  const median = returns.length ? (returns[Math.floor((returns.length - 1) / 2)] + returns[Math.ceil((returns.length - 1) / 2)]) / 2 : null;
  const bySymbolMap = new Map();
  for (const row of included) {
    const item = bySymbolMap.get(row.symbol) || { symbol: row.symbol, closedLegs: 0, wins: 0, losses: 0, flats: 0, returns: [] };
    item.closedLegs += 1;
    if (row.outcome === 'win') item.wins += 1;
    if (row.outcome === 'loss') item.losses += 1;
    if (row.outcome === 'flat') item.flats += 1;
    item.returns.push(Number(row.gross_return_pct));
    bySymbolMap.set(row.symbol, item);
  }
  const bySymbol = [...bySymbolMap.values()].map((item) => ({
    symbol: item.symbol,
    closedLegs: item.closedLegs,
    wins: item.wins,
    losses: item.losses,
    flats: item.flats,
    winRatePct: Number((item.wins / item.closedLegs * 100).toFixed(2)),
    averageReturnPct: Number((item.returns.reduce((sum, value) => sum + value, 0) / item.returns.length).toFixed(4))
  })).sort((a, b) => b.closedLegs - a.closedLegs || b.winRatePct - a.winRatePct);

  return {
    closedLegs: included.length,
    wins,
    losses,
    flats,
    winRatePct: included.length ? Number((wins / included.length * 100).toFixed(2)) : null,
    medianReturnPct: median == null ? null : Number(median.toFixed(4)),
    averageReturnPct: returns.length ? Number((returns.reduce((sum, value) => sum + value, 0) / returns.length).toFixed(4)) : null,
    bySymbol
  };
}

function buildStrategyReview(importRow, legRows, dailyRows, rawRows) {
  if (!importRow) return null;
  const timestamps = rawRows.map((row) => new Date(row.discord_created_at).getTime()).filter(Number.isFinite);
  // Anchor rolling windows to the newest captured message so signal KPIs and
  // account replay use the same data cut, even when the market is quiet.
  const anchor = new Date(Math.max(
    new Date(importRow.period_end).getTime(),
    ...(timestamps.length ? timestamps : [0])
  ));
  const definitions = {
    all: { label: '全部数据', start: new Date(importRow.period_start) },
    week: { label: '近 7 天', start: new Date(anchor.getTime() - 7 * 86400_000) },
    month: { label: '近 30 天', start: new Date(anchor.getTime() - 30 * 86400_000) }
  };
  const periods = Object.fromEntries(Object.entries(definitions).map(([key, definition]) => {
    const selectedLegs = legRows.filter((row) => new Date(row.occurred_at) >= definition.start && new Date(row.occurred_at) <= anchor);
    const selectedMessages = rawRows.filter((row) => new Date(row.discord_created_at) >= definition.start && new Date(row.discord_created_at) <= anchor);
    const strict = summarizeLegRows(selectedLegs);
    const { bySymbol, ...strictMetrics } = strict;
    const unresolvedTradeLike = selectedMessages.filter((row) => parseHistoricalTradeMessage(row.content).unresolvedReason === 'trade_like_but_not_strict').length;
    return [key, {
      key,
      label: definition.label,
      periodStart: definition.start.toISOString(),
      periodEnd: anchor.toISOString(),
      metrics: { ...strictMetrics, rawMessages: selectedMessages.length, parsedEvents: selectedLegs.length, tradeLikeUnresolved: unresolvedTradeLike },
      coverage: {
        rawMessages: selectedMessages.length,
        parsedEvents: selectedLegs.length,
        includedClosedLegs: strict.closedLegs,
        unresolvedTradeLike,
        duplicatesExcluded: selectedLegs.filter((row) => row.review_status === 'excluded_duplicate').length,
        needsReview: selectedLegs.filter((row) => row.review_status === 'needs_review').length
      },
      bySymbol
    }];
  }));
  const month = periods.month;

  return {
    mode: 'historical_plus_realtime',
    importId: importRow.id,
    periodStart: month.periodStart,
    periodEnd: month.periodEnd,
    completedAt: iso(importRow.completed_at),
    metrics: month.metrics,
    coverage: month.coverage,
    periods,
    bySymbol: month.bySymbol,
    dailyActivity: dailyRows.map((row) => ({ date: row.day, messages: Number(row.message_count) })),
    legs: legRows.map((row) => ({
      id: row.id,
      occurredAt: iso(row.occurred_at),
      action: row.action,
      symbol: row.symbol,
      entryPrice: Number(row.entry_price),
      exitPrice: nullableNumber(row.exit_price),
      positionFraction: nullableNumber(row.position_fraction),
      closedLeg: row.is_closed_leg,
      returnPct: nullableNumber(row.gross_return_pct),
      outcome: row.outcome,
      confidence: Number(row.confidence),
      reviewStatus: row.review_status,
      analysisIncluded: row.analysis_included,
      content: row.content
    }))
  };
}

function buildReplayPeriods(run, snapshotRows, eventRows) {
  if (!snapshotRows.length) return {};
  const anchor = new Date(run.period_end);
  const definitions = {
    all: { label: '全部数据', start: new Date(run.period_start) },
    week: { label: '近 7 天', start: new Date(anchor.getTime() - 7 * 86400_000) },
    month: { label: '近 30 天', start: new Date(anchor.getTime() - 30 * 86400_000) }
  };
  return Object.fromEntries(Object.entries(definitions).map(([key, definition]) => {
    const before = snapshotRows.filter((row) => new Date(row.occurred_at) < definition.start).at(-1) || snapshotRows[0];
    const selected = snapshotRows.filter((row) => new Date(row.occurred_at) >= definition.start);
    const curve = [before, ...selected.filter((row) => row.id !== before.id)];
    const baseline = Number(curve[0].equity);
    const final = Number(curve.at(-1).equity);
    let peak = baseline;
    let maxDrawdownPct = 0;
    for (const point of curve) {
      const equity = Number(point.equity);
      peak = Math.max(peak, equity);
      maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peak - 1) * 100);
    }
    const events = eventRows.filter((row) => new Date(row.occurred_at) >= definition.start);
    return [key, {
      key,
      label: definition.label,
      periodStart: definition.start.toISOString(),
      periodEnd: anchor.toISOString(),
      startEquity: baseline,
      finalEquity: final,
      totalReturnPct: (final / baseline - 1) * 100,
      maxDrawdownPct,
      realizedPnl: events.filter((row) => row.side === 'sell' && row.status === 'filled').reduce((sum, row) => sum + Number(row.realized_pnl), 0),
      filledBuys: events.filter((row) => row.side === 'buy' && row.status === 'filled').length,
      filledSells: events.filter((row) => row.side === 'sell' && row.status === 'filled').length,
      skippedUnmatched: events.filter((row) => row.status === 'skipped_unmatched').length
    }];
  }));
}

function mapAccountReplay(run, eventRows, snapshotRows, positionRows) {
  if (!run) return null;
  return {
    id: run.id,
    strategyVersion: run.strategy_version,
    status: run.status,
    periodStart: iso(run.period_start),
    periodEnd: iso(run.period_end),
    completedAt: iso(run.completed_at),
    periods: buildReplayPeriods(run, snapshotRows, eventRows),
    assumptions: run.assumptions || {},
    summary: {
      initialCapital: Number(run.initial_capital),
      finalEquity: Number(run.final_equity),
      cash: Number(run.cash),
      marketValue: Number(run.market_value),
      realizedPnl: Number(run.realized_pnl),
      unrealizedPnl: Number(run.unrealized_pnl),
      totalReturnPct: Number(run.total_return_pct),
      maxDrawdownPct: Number(run.max_drawdown_pct),
      peakUtilizationPct: Number(run.peak_utilization_pct),
      ...(run.metrics || {})
    },
    curve: snapshotRows.map((row) => ({
      sequence: Number(row.sequence),
      occurredAt: iso(row.occurred_at),
      cash: Number(row.cash),
      marketValue: Number(row.market_value),
      equity: Number(row.equity),
      returnPct: Number(row.return_pct),
      drawdownPct: Number(row.drawdown_pct),
      eventSide: row.event_side,
      eventSymbol: row.event_symbol,
      markSource: row.mark_source
    })),
    events: eventRows.map((row) => ({
      id: Number(row.id),
      sequence: Number(row.sequence),
      occurredAt: iso(row.occurred_at),
      side: row.side,
      symbol: row.symbol,
      quantity: Number(row.quantity),
      signalPrice: nullableNumber(row.signal_price),
      fillPrice: nullableNumber(row.fill_price),
      fees: Number(row.fees),
      realizedPnl: Number(row.realized_pnl),
      cashAfter: nullableNumber(row.cash_after),
      equityAfter: nullableNumber(row.equity_after),
      utilizationPct: nullableNumber(row.utilization_pct),
      status: row.status,
      reason: row.reason
    })),
    positions: positionRows.map((row) => ({
      symbol: row.symbol,
      quantity: Number(row.quantity),
      averageCost: Number(row.average_cost),
      markPrice: Number(row.mark_price),
      marketValue: Number(row.market_value),
      unrealizedPnl: Number(row.unrealized_pnl),
      markSource: row.mark_source
    }))
  };
}

export class PostgresRepository {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  }

  async health() {
    const result = await this.pool.query('select current_database() as database, now() as server_time');
    return { storage: 'postgres', ok: true, ...result.rows[0] };
  }

  async dashboard() {
    const [portfolio, positions, messages, signals, audit, historyImport, strategyLegs, dailyActivity, replayRun, rawStrategyMessages] = await Promise.all([
      this.pool.query('select * from portfolios order by created_at limit 1'),
      this.pool.query('select distinct on (symbol) * from position_snapshots order by symbol, captured_at desc'),
      this.pool.query('select * from discord_message_events order by received_at desc limit 50'),
      this.pool.query('select * from signal_interpretations order by created_at desc limit 50'),
      this.pool.query('select * from audit_events order by created_at desc limit 50'),
      this.pool.query("select * from discord_history_imports where status='completed' order by completed_at desc limit 1"),
      this.pool.query(`select l.*, m.content from strategy_trade_legs l join discord_message_events m on m.id=l.message_event_id
        where (m.channel_id,m.author_id)=(select channel_id,author_id from discord_message_events
          where history_import_id=(select id from discord_history_imports where status='completed' order by completed_at desc limit 1)
          group by channel_id,author_id order by count(*) desc limit 1)
        order by l.occurred_at desc, l.leg_index asc`),
      this.pool.query(`select to_char(discord_created_at at time zone 'Asia/Shanghai','YYYY-MM-DD') as day, count(*) as message_count
        from discord_message_events where event_type='create' and ingestion_mode<>'manual_test'
          and (channel_id,author_id)=(select channel_id,author_id from discord_message_events
            where history_import_id=(select id from discord_history_imports where status='completed' order by completed_at desc limit 1)
            group by channel_id,author_id order by count(*) desc limit 1)
          and discord_created_at >= now() - interval '30 days'
        group by 1 order by 1`),
      this.pool.query("select * from strategy_replay_runs where status='completed' order by completed_at desc limit 1"),
      this.pool.query(`select discord_message_id, content, discord_created_at
        from discord_message_events where event_type='create' and ingestion_mode<>'manual_test'
          and (channel_id,author_id)=(select channel_id,author_id from discord_message_events
            where history_import_id=(select id from discord_history_imports where status='completed' order by completed_at desc limit 1)
            group by channel_id,author_id order by count(*) desc limit 1)
        order by discord_created_at`)
    ]);
    const latestRun = replayRun.rows[0];
    const [replayEvents, replaySnapshots, replayPositions] = latestRun ? await Promise.all([
      this.pool.query('select * from strategy_replay_events where run_id=$1 order by occurred_at desc, sequence desc', [latestRun.id]),
      this.pool.query('select * from strategy_replay_snapshots where run_id=$1 order by sequence', [latestRun.id]),
      this.pool.query('select * from strategy_replay_positions where run_id=$1 order by market_value desc', [latestRun.id])
    ]) : [{ rows: [] }, { rows: [] }, { rows: [] }];
    const mappedPositions = positions.rows.map(mapPostgresPosition);
    return {
      portfolio: mapPostgresPortfolio(portfolio.rows[0], mappedPositions),
      positions: mappedPositions,
      messages: messages.rows.map(mapPostgresMessage),
      signals: signals.rows.map(mapPostgresSignal),
      audit: audit.rows.map(mapPostgresAudit),
      strategyReview: buildStrategyReview(historyImport.rows[0], strategyLegs.rows, dailyActivity.rows, rawStrategyMessages.rows),
      accountReplay: mapAccountReplay(latestRun, replayEvents.rows, replaySnapshots.rows, replayPositions.rows)
    };
  }

  async getPortfolio() {
    const portfolio = await this.pool.query('select * from portfolios order by created_at limit 1');
    const positions = await this.pool.query('select distinct on (symbol) * from position_snapshots order by symbol, captured_at desc');
    const row = portfolio.rows[0];
    if (!row) throw new Error('No portfolio configured');
    return {
      equity: Number(row.current_equity),
      cash: Number(row.current_cash),
      positions: positions.rows.map((p) => ({ symbol: p.symbol, marketValue: Number(p.market_value) }))
    };
  }

  async recordMessage(event) {
    const result = await this.pool.query(
      `insert into discord_message_events
       (discord_message_id, event_type, guild_id, channel_id, author_id, content, discord_created_at, received_at, raw_payload)
       values ($1,$2,$3,$4,$5,$6,$7,now(),$8)
       on conflict (discord_message_id) where event_type='create' and discord_message_id is not null do nothing
       returning *`,
      [event.messageId, event.eventType, event.guildId, event.channelId, event.authorId, event.content,
        event.discordCreatedAt, event.rawPayload || {}]
    );
    if (result.rowCount) return { ...mapPostgresMessage(result.rows[0]), isNew: true };
    const existing = await this.pool.query(
      "select * from discord_message_events where discord_message_id=$1 and event_type='create' limit 1",
      [event.messageId]
    );
    return { ...mapPostgresMessage(existing.rows[0]), isNew: false };
  }

  async latestDiscordMessageId({ guildId, channelId }) {
    const result = await this.pool.query(
      `select discord_message_id from discord_message_events
       where event_type='create' and guild_id=$1 and channel_id=$2 and discord_message_id is not null
       order by discord_created_at desc limit 1`,
      [guildId, channelId]
    );
    return result.rows[0]?.discord_message_id || null;
  }

  async recordStrategyLegs(messageEvent) {
    const parsed = parseHistoricalTradeMessage(messageEvent.content);
    if (!parsed.events.length) return { inserted: 0, unresolvedReason: parsed.unresolvedReason };
    const recent = await this.pool.query(
      `select discord_message_id, content from discord_message_events
       where event_type='create' and guild_id=$1 and channel_id=$2 and author_id=$3
         and id<>$4 and discord_created_at <= $5
       order by discord_created_at desc limit 5000`,
      [messageEvent.guildId, messageEvent.channelId, messageEvent.authorId, messageEvent.id, messageEvent.discordCreatedAt]
    );
    const duplicate = recent.rows.find((row) => normalizeZhaoMessage(row.content) === parsed.normalizedText);
    let inserted = 0;
    for (const [legIndex, event] of parsed.events.entries()) {
      const reviewStatus = duplicate ? 'excluded_duplicate' : event.reviewStatus;
      const analysisIncluded = event.closedLeg && !duplicate && reviewStatus === 'auto_included';
      const result = await this.pool.query(
        `insert into strategy_trade_legs
         (message_event_id,leg_index,parser_version,extraction_method,action,symbol,entry_price,exit_price,
          position_fraction,is_closed_leg,gross_return_pct,outcome,confidence,review_status,analysis_included,
          duplicate_of_message_id,notes,occurred_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         on conflict (message_event_id,leg_index,parser_version) do nothing`,
        [messageEvent.id, legIndex, event.parserVersion, event.extractionMethod, event.action, event.symbol,
          event.entryPrice, event.exitPrice, event.positionFraction, event.closedLeg, event.grossReturnPct, event.outcome,
          event.confidence, reviewStatus, analysisIncluded, duplicate?.discord_message_id || null, event.notes,
          messageEvent.discordCreatedAt]
      );
      inserted += result.rowCount;
    }
    return { inserted, unresolvedReason: null, duplicateOf: duplicate?.discord_message_id || null };
  }

  async recordSignal(signal) {
    const result = await this.pool.query(
      `insert into signal_interpretations
       (message_event_id, parser_name, parser_version, symbol, action, reference_price, position_fraction,
        stop_price, is_conditional, confidence, is_executable, reasons, status, parsed_payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending_review',$13) returning *`,
      [signal.messageEventId || null, signal.parser?.split(':')[0] || 'rules', signal.parser || 'rules-v1',
        signal.symbol, signal.action, signal.price, signal.fraction, signal.stopPrice, signal.conditional,
        signal.confidence, signal.executable, signal.reasons || [], signal]
    );
    return mapPostgresSignal(result.rows[0]);
  }

  async recordAudit(event) {
    await this.pool.query(
      'insert into audit_events (actor_type, actor_id, action, entity_type, entity_id, details) values ($1,$2,$3,$4,$5,$6)',
      [event.actorType || 'system', event.actorId || null, event.action, event.entityType, event.entityId || null, event.details || {}]
    );
  }

  async close() { await this.pool.end(); }
}
