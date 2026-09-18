import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSignal } from '../server/src/core/signal-parser.js';

test('parses NVDA half-position profit taking', () => {
  const result = parseSignal('减仓止盈半仓 NVDA 价格220');
  assert.equal(result.symbol, 'NVDA');
  assert.equal(result.action, 'sell');
  assert.equal(result.fraction, 0.5);
  assert.equal(result.price, 220);
  assert.equal(result.executable, true);
  assert.ok(result.confidence >= 0.85);
});

test('keeps observation messages non-executable', () => {
  const result = parseSignal('PLTR 先看 174 一带，冲高别追，等回踩再说');
  assert.equal(result.symbol, 'PLTR');
  assert.equal(result.action, 'note');
  assert.equal(result.conditional, true);
  assert.equal(result.executable, false);
});

test('parses first tranche and stop price', () => {
  const result = parseSignal('AAPL 252.5 先开一笔，仓位不要大，止损 248');
  assert.equal(result.action, 'buy');
  assert.equal(result.price, 252.5);
  assert.equal(result.fraction, 0.04);
  assert.equal(result.stopPrice, 248);
});
