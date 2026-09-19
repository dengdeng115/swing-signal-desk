const DEFAULTS = Object.freeze({
  initialCapital: 1_000_000,
  maxGrossUtilization: 0.70,
  maxSymbolWeight: 0.12,
  regularPositionWeight: 0.12,
  defaultTrancheFraction: 1 / 6,
  slippageBps: 10,
  feeBps: 2,
  duplicateCooldownHours: 24,
  entryMatchTolerancePct: 0.25
});

const number = (value) => value == null ? null : Number(value);
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

function latestEquity({ cash, lots, marks }) {
  const marketValue = lots.reduce((sum, lot) => sum + lot.quantity * (marks.get(lot.symbol) ?? lot.signalPrice), 0);
  return { marketValue, equity: cash + marketValue };
}

function isLongGapDuplicate(row, config) {
  if (row.reviewStatus !== 'excluded_duplicate' || !row.duplicateOriginalAt) return false;
  const gapMs = new Date(row.occurredAt) - new Date(row.duplicateOriginalAt);
  return gapMs > config.duplicateCooldownHours * 60 * 60 * 1000;
}

function inclusion(row, config) {
  if (row.reviewStatus === 'needs_review') return { include: false, reason: '待人工复核' };
  if (row.reviewStatus === 'excluded_duplicate' && !isLongGapDuplicate(row, config)) {
    return { include: false, reason: '24 小时内重复转发' };
  }
  return { include: true, reason: isLongGapDuplicate(row, config) ? '相同文字相隔超过 24 小时，按新操作处理' : null };
}

function closeFraction(row) {
  const content = String(row.content || '').replace(/\s+/g, '');
  if (/全部|清仓|剩下一半|剩下的|底仓/.test(content)) return 1;
  if (/出一半|一半的/.test(content)) return 0.5;
  if (number(row.positionFraction) != null) return Math.min(1, Math.max(0, number(row.positionFraction)));
  return 1;
}

function findLot(lots, row, config) {
  const entry = number(row.entryPrice);
  const tolerance = Math.max(0.03, entry * config.entryMatchTolerancePct / 100);
  return lots
    .map((lot, index) => ({ lot, index, delta: Math.abs(lot.signalPrice - entry) }))
    .filter((item) => item.lot.symbol === row.symbol && item.lot.quantity > 0 && item.delta <= tolerance)
    .sort((a, b) => a.delta - b.delta || new Date(a.lot.openedAt) - new Date(b.lot.openedAt))[0] || null;
}

function snapshot({ sequence, occurredAt, cash, lots, marks, initialCapital, peakEquity, event }) {
  const values = latestEquity({ cash, lots, marks });
  const nextPeak = Math.max(peakEquity, values.equity);
  return {
    item: {
      sequence,
      occurredAt,
      cash: round(cash),
      marketValue: round(values.marketValue),
      equity: round(values.equity),
      returnPct: round((values.equity / initialCapital - 1) * 100, 6),
      drawdownPct: round((values.equity / nextPeak - 1) * 100, 6),
      event
    },
    peakEquity: nextPeak
  };
}

/**
 * Deterministic, finite-capital paper replay. It starts with cash only and never
 * invents positions that pre-date the selected history window.
 */
export function replayPortfolio(inputRows, overrides = {}) {
  const config = { ...DEFAULTS, ...overrides };
  const rows = [...inputRows].map((row) => ({
    ...row,
    entryPrice: number(row.entryPrice),
    exitPrice: number(row.exitPrice),
    positionFraction: number(row.positionFraction)
  })).sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt) || Number(a.legIndex || 0) - Number(b.legIndex || 0));

  let cash = config.initialCapital;
  let realizedPnl = 0;
  let totalFees = 0;
  let peakEquity = config.initialCapital;
  let peakUtilizationPct = 0;
  let sequence = 0;
  const lots = [];
  const events = [];
  const snapshots = [];
  const marks = new Map();
  const soldPools = new Map();

  const recordSnapshot = (row, event) => {
    const result = snapshot({ sequence: ++sequence, occurredAt: row.occurredAt, cash, lots, marks, initialCapital: config.initialCapital, peakEquity, event });
    peakEquity = result.peakEquity;
    peakUtilizationPct = Math.max(peakUtilizationPct, result.item.marketValue / result.item.equity * 100);
    snapshots.push(result.item);
    return result.item;
  };

  snapshots.push({ sequence, occurredAt: rows[0]?.occurredAt || new Date().toISOString(), cash, marketValue: 0, equity: cash, returnPct: 0, drawdownPct: 0, event: null });

  for (const row of rows) {
    const gate = inclusion(row, config);
    if (!gate.include) {
      events.push({ tradeLegId: row.id, messageEventId: row.messageEventId, occurredAt: row.occurredAt, side: 'skipped', symbol: row.symbol, signalPrice: row.action === 'sell' ? row.exitPrice : row.entryPrice, status: 'skipped_review', reason: gate.reason, quantity: 0, fees: 0, realizedPnl: 0 });
      continue;
    }

    if (row.action === 'buy' || row.action === 'rebuy') {
      const signalPrice = row.entryPrice;
      marks.set(row.symbol, signalPrice);
      const before = latestEquity({ cash, lots, marks });
      const currentSymbolValue = lots.filter((lot) => lot.symbol === row.symbol).reduce((sum, lot) => sum + lot.quantity * signalPrice, 0);
      const grossRoom = Math.max(0, before.equity * config.maxGrossUtilization - before.marketValue);
      const symbolRoom = Math.max(0, before.equity * config.maxSymbolWeight - currentSymbolValue);
      const cashRoom = Math.max(0, cash - before.equity * (1 - config.maxGrossUtilization));
      let desiredQuantity = null;
      let sizingReason = '按常规仓比例分批';

      if (row.action === 'rebuy') {
        const pool = soldPools.get(row.symbol) || [];
        const priorSale = pool.pop();
        if (priorSale) {
          desiredQuantity = priorSale.quantity;
          sizingReason = '加回最近一次已卖出的数量';
        }
      }

      const fraction = row.positionFraction ?? config.defaultTrancheFraction;
      const desiredNotional = desiredQuantity == null ? before.equity * config.regularPositionWeight * fraction : desiredQuantity * signalPrice;
      const allowedNotional = Math.min(desiredNotional, grossRoom, symbolRoom, cashRoom);
      const fillPrice = signalPrice * (1 + config.slippageBps / 10_000);
      const quantity = Math.max(0, Math.floor(allowedNotional / (fillPrice * (1 + config.feeBps / 10_000))));

      if (!Number.isFinite(signalPrice) || signalPrice <= 0 || quantity < 1) {
        const event = { tradeLegId: row.id, messageEventId: row.messageEventId, occurredAt: row.occurredAt, side: 'buy', symbol: row.symbol, signalPrice, fillPrice: null, quantity: 0, fees: 0, realizedPnl: 0, status: 'skipped_risk', reason: '现金、总仓位或单标的上限不足' };
        const point = recordSnapshot(row, { side: 'skipped', symbol: row.symbol, status: event.status });
        events.push({ ...event, cashAfter: point.cash, equityAfter: point.equity, utilizationPct: point.marketValue / point.equity * 100 });
        continue;
      }

      const notional = quantity * fillPrice;
      const fees = notional * config.feeBps / 10_000;
      cash -= notional + fees;
      totalFees += fees;
      lots.push({
        id: `${row.id}:${lots.length}`,
        tradeLegId: row.id,
        symbol: row.symbol,
        quantity,
        originalQuantity: quantity,
        signalPrice,
        fillPrice,
        costPerShare: (notional + fees) / quantity,
        openedAt: row.occurredAt,
        sizingReason
      });
      const point = recordSnapshot(row, { side: 'buy', symbol: row.symbol, status: 'filled' });
      events.push({ tradeLegId: row.id, messageEventId: row.messageEventId, occurredAt: row.occurredAt, side: 'buy', symbol: row.symbol, quantity, signalPrice, fillPrice: round(fillPrice, 6), fees: round(fees, 6), realizedPnl: 0, cashAfter: point.cash, equityAfter: point.equity, utilizationPct: round(point.marketValue / point.equity * 100, 6), status: 'filled', reason: gate.reason || sizingReason });
      continue;
    }

    if (row.action === 'sell') {
      const signalPrice = row.exitPrice;
      marks.set(row.symbol, signalPrice);
      const match = findLot(lots, row, config);
      if (!match) {
        const event = { tradeLegId: row.id, messageEventId: row.messageEventId, occurredAt: row.occurredAt, side: 'sell', symbol: row.symbol, signalPrice, fillPrice: null, quantity: 0, fees: 0, realizedPnl: 0, status: 'skipped_unmatched', reason: '本月窗口内没有可核对的对应买入批次（可能是期初遗留仓位）' };
        const point = recordSnapshot(row, { side: 'skipped', symbol: row.symbol, status: event.status });
        events.push({ ...event, cashAfter: point.cash, equityAfter: point.equity, utilizationPct: round(point.marketValue / point.equity * 100, 6) });
        continue;
      }

      const fraction = closeFraction(row);
      const quantity = fraction >= 0.999 ? match.lot.quantity : Math.max(1, Math.floor(match.lot.quantity * fraction));
      const fillPrice = signalPrice * (1 - config.slippageBps / 10_000);
      const proceeds = quantity * fillPrice;
      const fees = proceeds * config.feeBps / 10_000;
      const eventRealized = proceeds - fees - quantity * match.lot.costPerShare;
      cash += proceeds - fees;
      realizedPnl += eventRealized;
      totalFees += fees;
      match.lot.quantity -= quantity;
      const pool = soldPools.get(row.symbol) || [];
      pool.push({ quantity, soldAt: row.occurredAt });
      soldPools.set(row.symbol, pool);
      const point = recordSnapshot(row, { side: 'sell', symbol: row.symbol, status: 'filled' });
      events.push({ tradeLegId: row.id, messageEventId: row.messageEventId, occurredAt: row.occurredAt, side: 'sell', symbol: row.symbol, quantity, signalPrice, fillPrice: round(fillPrice, 6), fees: round(fees, 6), realizedPnl: round(eventRealized, 6), cashAfter: point.cash, equityAfter: point.equity, utilizationPct: round(point.marketValue / point.equity * 100, 6), status: 'filled', reason: fraction >= 0.999 ? '卖出对应批次剩余数量' : '卖出对应批次的一半' });
    }
  }

  const quoteMap = overrides.finalQuotes || {};
  for (const [symbol, price] of Object.entries(quoteMap)) {
    if (Number.isFinite(Number(price)) && Number(price) > 0) marks.set(symbol, Number(price));
  }
  if (Object.keys(quoteMap).length) {
    const row = { occurredAt: overrides.finalQuoteTime || new Date().toISOString() };
    const point = recordSnapshot(row, { side: 'mark', symbol: null, status: 'longbridge_mark' });
    point.markSource = 'longbridge';
  }

  const activeLots = lots.filter((lot) => lot.quantity > 0);
  const positions = [...new Set(activeLots.map((lot) => lot.symbol))].map((symbol) => {
    const symbolLots = activeLots.filter((lot) => lot.symbol === symbol);
    const quantity = symbolLots.reduce((sum, lot) => sum + lot.quantity, 0);
    const cost = symbolLots.reduce((sum, lot) => sum + lot.quantity * lot.costPerShare, 0);
    const markPrice = marks.get(symbol) ?? symbolLots.at(-1).signalPrice;
    return {
      symbol,
      quantity,
      averageCost: round(cost / quantity, 6),
      markPrice: round(markPrice, 6),
      marketValue: round(quantity * markPrice),
      unrealizedPnl: round(quantity * markPrice - cost),
      markSource: Object.hasOwn(quoteMap, symbol) ? 'longbridge' : 'last_signal'
    };
  }).sort((a, b) => b.marketValue - a.marketValue);

  const final = snapshots.at(-1);
  const maxDrawdownPct = Math.min(...snapshots.map((item) => item.drawdownPct));
  const filled = events.filter((event) => event.status === 'filled');
  return {
    strategyVersion: 'finite-capital-v1',
    assumptions: config,
    summary: {
      initialCapital: config.initialCapital,
      finalEquity: final.equity,
      cash: final.cash,
      marketValue: final.marketValue,
      realizedPnl: round(realizedPnl),
      unrealizedPnl: round(positions.reduce((sum, position) => sum + position.unrealizedPnl, 0)),
      totalReturnPct: round((final.equity / config.initialCapital - 1) * 100, 6),
      maxDrawdownPct: round(maxDrawdownPct, 6),
      peakUtilizationPct: round(peakUtilizationPct, 6),
      totalFees: round(totalFees),
      filledBuys: filled.filter((event) => event.side === 'buy').length,
      filledSells: filled.filter((event) => event.side === 'sell').length,
      skippedUnmatched: events.filter((event) => event.status === 'skipped_unmatched').length,
      skippedReview: events.filter((event) => event.status === 'skipped_review').length,
      skippedRisk: events.filter((event) => event.status === 'skipped_risk').length,
      openPositions: positions.length
    },
    events,
    snapshots,
    positions
  };
}

export { DEFAULTS as portfolioReplayDefaults };
