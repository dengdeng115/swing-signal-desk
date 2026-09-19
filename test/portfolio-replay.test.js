import test from 'node:test';
import assert from 'node:assert/strict';
import { replayPortfolio } from '../server/src/core/portfolio-replay.js';

const row = (values) => ({
  id: crypto.randomUUID(),
  messageEventId: crypto.randomUUID(),
  legIndex: 0,
  reviewStatus: 'auto_included',
  occurredAt: '2026-09-01T14:00:00Z',
  content: '',
  ...values
});

test('replays a finite-capital tranche with costs and a matched exit', () => {
  const result = replayPortfolio([
    row({ action: 'buy', symbol: 'NVDA', entryPrice: 210, positionFraction: 1 / 6 }),
    row({ action: 'sell', symbol: 'NVDA', entryPrice: 210, exitPrice: 220, positionFraction: 1, occurredAt: '2026-09-02T14:00:00Z', content: '220 全部卖出 210 的 NVDA' })
  ]);

  assert.equal(result.summary.filledBuys, 1);
  assert.equal(result.summary.filledSells, 1);
  assert.equal(result.positions.length, 0);
  assert.ok(result.summary.totalReturnPct > 0.08);
  assert.ok(result.summary.totalReturnPct < 0.11);
  assert.ok(result.summary.totalFees > 0);
});

test('does not invent an opening position for an unmatched exit', () => {
  const result = replayPortfolio([
    row({ action: 'sell', symbol: 'NVDA', entryPrice: 210, exitPrice: 220, positionFraction: 1, content: '220 出掉 210 的 NVDA' })
  ]);

  assert.equal(result.summary.finalEquity, 1_000_000);
  assert.equal(result.summary.skippedUnmatched, 1);
  assert.equal(result.summary.filledSells, 0);
});

test('caps repeated buys at the per-symbol allocation limit', () => {
  const result = replayPortfolio(Array.from({ length: 10 }, (_, index) => row({
    action: 'buy', symbol: 'NVDA', entryPrice: 100, positionFraction: 1 / 6,
    occurredAt: `2026-09-${String(index + 1).padStart(2, '0')}T14:00:00Z`
  })));

  assert.ok(result.positions[0].marketValue <= 120_000);
  assert.ok(result.summary.skippedRisk > 0);
});

test('uses a fresh Longbridge mark for an open position', () => {
  const result = replayPortfolio([
    row({ action: 'buy', symbol: 'NVDA', entryPrice: 100, positionFraction: 1 / 6 })
  ], { finalQuotes: { NVDA: 110 }, finalQuoteTime: '2026-09-19T12:00:00Z' });

  assert.equal(result.positions[0].markSource, 'longbridge');
  assert.equal(result.positions[0].markPrice, 110);
  assert.ok(result.summary.unrealizedPnl > 0);
  assert.equal(Object.hasOwn(result.assumptions, 'finalQuotes'), false);
});

test('keeps immediate duplicates out but treats a long-gap repeat as a new signal', () => {
  const original = '2026-09-01T14:00:00Z';
  const result = replayPortfolio([
    row({ action: 'buy', symbol: 'NVDA', entryPrice: 100, positionFraction: 1 / 6, occurredAt: original }),
    row({ action: 'buy', symbol: 'NVDA', entryPrice: 100, positionFraction: 1 / 6, reviewStatus: 'excluded_duplicate', duplicateOriginalAt: original, occurredAt: '2026-09-01T15:00:00Z' }),
    row({ action: 'buy', symbol: 'NVDA', entryPrice: 100, positionFraction: 1 / 6, reviewStatus: 'excluded_duplicate', duplicateOriginalAt: original, occurredAt: '2026-09-03T15:00:00Z' })
  ]);

  assert.equal(result.summary.filledBuys, 2);
  assert.equal(result.summary.skippedReview, 1);
});

test('shows the account return sensitivity to worse execution costs', () => {
  const rows = [
    row({ action: 'buy', symbol: 'NVDA', entryPrice: 210, positionFraction: 1 / 6 }),
    row({ action: 'sell', symbol: 'NVDA', entryPrice: 210, exitPrice: 220, positionFraction: 1, occurredAt: '2026-09-02T14:00:00Z', content: '220 全部卖出 210 的 NVDA' })
  ];
  const lowCost = replayPortfolio(rows, { slippageBps: 5, feeBps: 1 });
  const base = replayPortfolio(rows, { slippageBps: 10, feeBps: 2 });
  const stressed = replayPortfolio(rows, { slippageBps: 30, feeBps: 5 });

  assert.ok(lowCost.summary.totalReturnPct > base.summary.totalReturnPct);
  assert.ok(base.summary.totalReturnPct > stressed.summary.totalReturnPct);
  assert.ok(lowCost.summary.totalFees < base.summary.totalFees);
  assert.ok(base.summary.totalFees < stressed.summary.totalFees);
});
