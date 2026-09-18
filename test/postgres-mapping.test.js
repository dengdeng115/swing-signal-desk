import test from 'node:test';
import assert from 'node:assert/strict';
import { mapPostgresMessage, mapPostgresPosition, mapPostgresSignal } from '../server/src/db/postgres-repository.js';

test('maps PostgreSQL message rows to the public API shape', () => {
  const mapped = mapPostgresMessage({
    id: 'event-1',
    received_at: '2026-09-18T15:00:00.000Z',
    event_type: 'update',
    discord_message_id: 'message-1',
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    author_id: 'author-1',
    content: '价格222',
    discord_created_at: '2026-09-18T14:59:59.000Z',
    raw_payload: { attachments: [] }
  });

  assert.equal(mapped.eventType, 'update');
  assert.equal(mapped.messageId, 'message-1');
  assert.equal(mapped.recordedAt, '2026-09-18T15:00:00.000Z');
  assert.deepEqual(mapped.rawPayload, { attachments: [] });
});

test('maps PostgreSQL signal numerics and preserved parsed payload', () => {
  const mapped = mapPostgresSignal({
    id: 'signal-1',
    status: 'pending_review',
    created_at: '2026-09-18T15:00:00.000Z',
    parser_version: 'rules-v1',
    symbol: 'NVDA',
    action: 'sell',
    reference_price: '222.000000',
    position_fraction: '0.50000000',
    stop_price: null,
    is_conditional: false,
    confidence: '1.000000',
    is_executable: true,
    reasons: [],
    message_event_id: 'event-1',
    parsed_payload: { parser: 'rules-v1.1', rawText: '减仓止盈半仓 NVDA 价格222', ambiguous: false, risk: { mode: 'paper_only' } }
  });

  assert.equal(mapped.price, 222);
  assert.equal(mapped.fraction, 0.5);
  assert.equal(mapped.rawText, '减仓止盈半仓 NVDA 价格222');
  assert.equal(mapped.ambiguous, false);
  assert.deepEqual(mapped.risk, { mode: 'paper_only' });
});

test('maps PostgreSQL position numerics', () => {
  const mapped = mapPostgresPosition({
    id: 'position-1',
    symbol: 'NVDA',
    quantity: '10.000000',
    average_cost: '200.000000',
    last_price: '222.000000',
    market_value: '2220.000000',
    unrealized_pnl: '220.000000',
    realized_pnl: '0.000000',
    captured_at: '2026-09-18T15:00:00.000Z'
  });

  assert.equal(mapped.quantity, 10);
  assert.equal(mapped.marketValue, 2220);
  assert.equal(mapped.capturedAt, '2026-09-18T15:00:00.000Z');
});
