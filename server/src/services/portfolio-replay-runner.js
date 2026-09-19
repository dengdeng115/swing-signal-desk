import { replayPortfolio } from '../core/portfolio-replay.js';

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

async function fetchMarks(quoteService, symbols) {
  const marks = {};
  const failures = [];
  for (let index = 0; index < symbols.length; index += 20) {
    const batch = symbols.slice(index, index + 20);
    try {
      const result = await quoteService.getQuotes(batch);
      for (const quote of result.quotes) {
        const price = latestTradablePrice(quote);
        if (Number.isFinite(price) && price > 0) marks[quote.symbol] = price;
      }
    } catch {
      for (const symbol of batch) {
        try {
          const result = await quoteService.getQuotes([symbol]);
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

export async function runPortfolioReplay({ pool, quoteService, now = () => new Date() }) {
  const history = await pool.query("select * from discord_history_imports where status='completed' order by completed_at desc limit 1");
  if (!history.rowCount) throw new Error('No completed Discord history import found');
  const importRow = history.rows[0];
  const legs = await pool.query(`
    select l.*, m.content, orig.discord_created_at as duplicate_original_at
    from strategy_trade_legs l
    join discord_message_events m on m.id = l.message_event_id
    left join discord_message_events orig
      on orig.discord_message_id = l.duplicate_of_message_id and orig.event_type = 'create'
    where l.occurred_at >= $1
      and (m.channel_id,m.author_id)=(select channel_id,author_id from discord_message_events
        where history_import_id=$2 group by channel_id,author_id order by count(*) desc limit 1)
    order by l.occurred_at, l.leg_index`, [importRow.period_start, importRow.id]);

  const input = rowsToReplayInput(legs.rows);
  const preliminary = replayPortfolio(input);
  const { marks, failures } = await fetchMarks(quoteService, preliminary.positions.map((position) => position.symbol));
  const finalQuoteTime = now().toISOString();
  const scenarioDefinitions = [
    { id: 'low_cost', label: '理想成交', slippageBps: 5, feeBps: 1 },
    { id: 'base', label: '当前模型', slippageBps: 10, feeBps: 2 },
    { id: 'delay_stress', label: '延迟压力', slippageBps: 30, feeBps: 5 }
  ];
  const scenarioRuns = scenarioDefinitions.map((scenario) => ({
    ...scenario,
    replay: replayPortfolio(input, { slippageBps: scenario.slippageBps, feeBps: scenario.feeBps, finalQuotes: marks, finalQuoteTime })
  }));
  const result = scenarioRuns.find((scenario) => scenario.id === 'base').replay;
  const scenarios = scenarioRuns.map(({ replay, ...scenario }) => ({
    ...scenario,
    totalReturnPct: replay.summary.totalReturnPct,
    finalEquity: replay.summary.finalEquity,
    maxDrawdownPct: replay.summary.maxDrawdownPct,
    totalFees: replay.summary.totalFees
  }));
  const sellSignals = result.summary.filledSells + result.summary.skippedUnmatched;
  const matchedSellRatePct = sellSignals ? result.summary.filledSells / sellSignals * 100 : null;
  const quoteCoveragePct = result.summary.openPositions
    ? Object.keys(marks).length / result.summary.openPositions * 100
    : 100;
  const periodEnd = legs.rows.length
    ? new Date(Math.max(new Date(importRow.period_end).getTime(), ...legs.rows.map((row) => new Date(row.occurred_at).getTime())))
    : new Date(importRow.period_end);

  const client = await pool.connect();
  let runId;
  try {
    await client.query('begin');
    const inserted = await client.query(`insert into strategy_replay_runs
      (history_import_id,strategy_version,status,period_start,period_end,initial_capital,final_equity,cash,market_value,
       realized_pnl,unrealized_pnl,total_return_pct,max_drawdown_pct,peak_utilization_pct,assumptions,metrics,completed_at)
      values ($1,$2,'completed',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()) returning id`, [
      importRow.id, result.strategyVersion, importRow.period_start, periodEnd,
      result.summary.initialCapital, result.summary.finalEquity, result.summary.cash, result.summary.marketValue,
      result.summary.realizedPnl, result.summary.unrealizedPnl, result.summary.totalReturnPct,
      result.summary.maxDrawdownPct, result.summary.peakUtilizationPct,
      result.assumptions, {
        ...result.summary,
        quoteFailures: failures,
        longbridgeMarks: Object.keys(marks).length,
        quoteCoveragePct,
        matchedSellRatePct,
        scenarios
      }
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
  }

  return { runId, strategyVersion: result.strategyVersion,
    summary: { ...result.summary, quoteCoveragePct, matchedSellRatePct, scenarios },
    quoteFailures: failures, positions: result.positions };
}

export function createReplayRefreshScheduler({ pool, quoteService, onComplete = () => {}, delayMs = 5_000 }) {
  let timer = null;
  let running = false;
  let pending = false;
  let lastRunAt = null;
  let lastError = null;
  async function execute(reason) {
    if (running) { pending = true; return; }
    running = true;
    try {
      const result = await runPortfolioReplay({ pool, quoteService });
      lastRunAt = new Date().toISOString();
      lastError = null;
      onComplete({ type: 'replay_refreshed', data: { ...result.summary, runId: result.runId, reason, completedAt: lastRunAt } });
    } catch (error) {
      lastError = error.message;
      console.error('Automatic portfolio replay failed', error);
    } finally {
      running = false;
      if (pending) { pending = false; schedule('coalesced_update'); }
    }
  }
  function schedule(reason = 'strategy_changed') {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; execute(reason); }, delayMs);
  }
  return { schedule, status: () => ({ running, pending: Boolean(timer) || pending, lastRunAt, lastError }) };
}
