import pg from 'pg';

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

export class PostgresRepository {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  }

  async health() {
    const result = await this.pool.query('select current_database() as database, now() as server_time');
    return { storage: 'postgres', ok: true, ...result.rows[0] };
  }

  async dashboard() {
    const [portfolio, positions, messages, signals, audit] = await Promise.all([
      this.pool.query('select * from portfolios order by created_at limit 1'),
      this.pool.query('select distinct on (symbol) * from position_snapshots order by symbol, captured_at desc'),
      this.pool.query('select * from discord_message_events order by received_at desc limit 50'),
      this.pool.query('select * from signal_interpretations order by created_at desc limit 50'),
      this.pool.query('select * from audit_events order by created_at desc limit 50')
    ]);
    const mappedPositions = positions.rows.map(mapPostgresPosition);
    return {
      portfolio: mapPostgresPortfolio(portfolio.rows[0], mappedPositions),
      positions: mappedPositions,
      messages: messages.rows.map(mapPostgresMessage),
      signals: signals.rows.map(mapPostgresSignal),
      audit: audit.rows.map(mapPostgresAudit)
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
       values ($1,$2,$3,$4,$5,$6,$7,now(),$8) returning *`,
      [event.messageId, event.eventType, event.guildId, event.channelId, event.authorId, event.content,
        event.discordCreatedAt, event.rawPayload || {}]
    );
    return mapPostgresMessage(result.rows[0]);
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
