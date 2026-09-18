import pg from 'pg';

export class PostgresRepository {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  }

  async health() {
    const result = await this.pool.query('select current_database() as database, now() as server_time');
    return { storage: 'postgres', ok: true, ...result.rows[0] };
  }

  async dashboard() {
    const [portfolio, positions, messages, signals] = await Promise.all([
      this.pool.query('select * from portfolios order by created_at limit 1'),
      this.pool.query('select * from position_snapshots order by captured_at desc limit 100'),
      this.pool.query('select * from discord_message_events order by received_at desc limit 50'),
      this.pool.query('select * from signal_interpretations order by created_at desc limit 50')
    ]);
    return { portfolio: portfolio.rows[0] || null, positions: positions.rows, messages: messages.rows, signals: signals.rows };
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
    return result.rows[0];
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
    return result.rows[0];
  }

  async recordAudit(event) {
    await this.pool.query(
      'insert into audit_events (actor_type, actor_id, action, entity_type, entity_id, details) values ($1,$2,$3,$4,$5,$6)',
      [event.actorType || 'system', event.actorId || null, event.action, event.entityType, event.entityId || null, event.details || {}]
    );
  }

  async close() { await this.pool.end(); }
}
