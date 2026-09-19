import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHistoricalTradeMessage, summarizeHistoricalMessages } from '../server/src/core/historical-trade-parser.js';

test('parses a strict partial exit and computes the user requested return', () => {
  const result = parseHistoricalTradeMessage('@everyone\n\n赵哥-股票： 220出一半210的nvda');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].symbol, 'NVDA');
  assert.equal(result.events[0].positionFraction, 0.5);
  assert.equal(result.events[0].grossReturnPct, 4.761905);
});

test('keeps rebuy separate from a closed sell leg', () => {
  const result = parseHistoricalTradeMessage('赵哥-股票： 89.6加回94.22卖出那部分crwv');
  assert.equal(result.events[0].action, 'rebuy');
  assert.equal(result.events[0].closedLeg, false);
  assert.equal(result.events[0].grossReturnPct, null);
});

test('rejects narrative examples that previously created extreme false returns', () => {
  const result = parseHistoricalTradeMessage('这轮7700抄底的 还是买2卖1 急跌吸 异动出一半 conl');
  assert.equal(result.events.length, 0);
  assert.equal(result.unresolvedReason, 'trade_like_but_not_strict');
});

test('creates separate legs for multiple explicit entry batches and excludes retained batch', () => {
  const result = parseHistoricalTradeMessage('18.05出掉15.8和15.7的cifr 保留15.1的');
  assert.deepEqual(result.events.map((event) => event.entryPrice), [15.8, 15.7]);
});

test('deduplicates repeated normalized messages from win-rate denominator', () => {
  const content = '104.6出一半100的soxl';
  const summary = summarizeHistoricalMessages([
    { messageId: '1', content },
    { messageId: '2', content }
  ]);
  assert.equal(summary.metrics.closedLegs, 1);
  assert.equal(summary.metrics.duplicateEvents, 1);
});
