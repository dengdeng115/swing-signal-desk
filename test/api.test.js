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
  assert.equal(response.body.version, '0.6.0');
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
  assert.match(worker.text, /swing-signal-desk-v060/);
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
