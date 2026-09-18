import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePaperSignal } from '../server/src/core/risk-engine.js';

const config = {
  minAutoParseConfidence: 0.85,
  maxSignalAgeSeconds: 120,
  maxGrossUtilization: 0.70,
  maxSymbolWeight: 0.20,
  minCashReserve: 0.30
};
const portfolio = { equity: 1_000_000, cash: 500_000, positions: [{ symbol: 'NVDA', marketValue: 150_000 }] };

test('always requires human confirmation even when paper eligible', () => {
  const result = evaluatePaperSignal({
    signal: { symbol: 'AMD', action: 'buy', fraction: 0.04, confidence: 0.95, executable: true },
    portfolio,
    config
  });
  assert.equal(result.eligible, true);
  assert.equal(result.requiresHumanConfirmation, true);
  assert.equal(result.mode, 'paper_only');
});

test('blocks a buy that breaks symbol concentration', () => {
  const result = evaluatePaperSignal({
    signal: { symbol: 'NVDA', action: 'buy', fraction: 0.10, confidence: 0.95, executable: true },
    portfolio,
    config
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('将超过单一股票仓位上限'));
});

test('blocks stale messages', () => {
  const now = new Date('2026-09-18T12:05:00Z');
  const receivedAt = new Date('2026-09-18T12:00:00Z');
  const result = evaluatePaperSignal({
    signal: { symbol: 'AMD', action: 'buy', fraction: 0.04, confidence: 0.95, executable: true },
    portfolio,
    config,
    receivedAt,
    now
  });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('消息超过允许时延'));
});
