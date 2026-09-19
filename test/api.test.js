import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/src/app.js';
import { MemoryRepository } from '../server/src/db/memory-repository.js';

const config = {
  appOrigin: 'http://localhost:8787',
  discord: { enabled: false },
  ai: { enabled: false },
  risk: {
    initialCapital: 1_000_000,
    maxGrossUtilization: 0.70,
    maxSymbolWeight: 0.20,
    minCashReserve: 0.30,
    minAutoParseConfidence: 0.85,
    maxSignalAgeSeconds: 120
  }
};

test('health reports memory storage and disabled integrations', async () => {
  const response = await request(createApp({ config, repository: new MemoryRepository() })).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.version, '0.7.0');
  assert.equal(response.body.storage, 'memory');
  assert.equal(response.body.integrations.discord, false);
});

test('desktop web app assets are available', async () => {
  const app = createApp({ config, repository: new MemoryRepository() });
  const [manifest, worker, icon] = await Promise.all([
    request(app).get('/manifest.webmanifest'),
    request(app).get('/service-worker.js'),
    request(app).get('/icon.svg')
  ]);
  assert.equal(manifest.status, 200);
  assert.equal(manifest.body.display, 'standalone');
  assert.equal(worker.status, 200);
  assert.match(worker.text, /swing-signal-desk-v070/);
  assert.equal(icon.status, 200);
});

test('manual parse creates an auditable candidate', async () => {
  const response = await request(createApp({ config, repository: new MemoryRepository() }))
    .post('/api/signals/parse')
    .send({ text: '减仓止盈半仓 NVDA 价格220' });
  assert.equal(response.status, 201);
  assert.equal(response.body.symbol, 'NVDA');
  assert.equal(response.body.risk.mode, 'paper_only');
  assert.equal(response.body.risk.requiresHumanConfirmation, true);
});

test('market quote endpoint uses the injected read-only quote service', async () => {
  const quoteService = { getQuotes: async (symbols) => ({ source: 'longbridge', quotes: [{ symbol: symbols[0], last: 220 }] }) };
  const response = await request(createApp({ config, repository: new MemoryRepository(), quoteService }))
    .get('/api/market/quotes?symbols=NVDA');
  assert.equal(response.status, 200);
  assert.equal(response.body.source, 'longbridge');
  assert.equal(response.body.quotes[0].last, 220);
});

test('Discord catch-up endpoint is explicit when the bot is unavailable', async () => {
  const response = await request(createApp({ config, repository: new MemoryRepository() }))
    .post('/api/discord/sync');
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'discord_sync_unavailable');
});

test('message create ingestion is idempotent during catch-up', async () => {
  const repository = new MemoryRepository();
  const event = { messageId: 'discord-1', eventType: 'create', guildId: 'g', channelId: 'c', content: 'hello', discordCreatedAt: '2026-09-19T00:00:00Z' };
  const first = await repository.recordMessage(event);
  const second = await repository.recordMessage(event);
  assert.equal(first.isNew, true);
  assert.equal(second.isNew, false);
  assert.equal((await repository.dashboard()).messages.length, 1);
});

test('message history is paginated and an acknowledged review leaves the pending queue', async () => {
  const repository = new MemoryRepository();
  const message = await repository.recordMessage({
    messageId: 'discord-review-1', eventType: 'create', guildId: 'g', channelId: 'c', authorId: 'a',
    content: '这轮7700抄底的 还是买2卖1 急跌吸 异动出一半 conl', discordCreatedAt: new Date().toISOString()
  });
  const app = createApp({ config, repository });
  const history = await request(app).get('/api/history/messages?page=1&pageSize=10');
  assert.equal(history.status, 200);
  assert.equal(history.body.total, 1);
  assert.equal(history.body.items[0].kind, 'needs_review');
  const beforeReview = await repository.dashboard();
  assert.equal(beforeReview.liveDesk.pendingReviewCount, 1);
  assert.equal(beforeReview.liveDesk.latestMessages[0].isFresh, true);

  const review = await request(app).post(`/api/messages/${message.id}/review`).send({ decision: 'confirm' });
  assert.equal(review.status, 201);
  assert.equal(review.body.decision, 'confirm');
  assert.equal((await repository.dashboard()).liveDesk.pendingReviewCount, 0);
  assert.equal((await repository.dashboard()).messages.length, 1);
});
