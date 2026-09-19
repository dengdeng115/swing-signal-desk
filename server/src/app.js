import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSignal } from './core/signal-parser.js';
import { parseSignalWithAI } from './services/ai-parser.js';
import { evaluatePaperSignal } from './core/risk-engine.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(currentDir, '../../dist');

export function createApp({ config, repository, quoteService = null }) {
  const app = express();
  const sseClients = new Set();

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.appOrigin }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', async (_request, response, next) => {
    try {
      response.json({ ok: true, version: '0.5.0', integrations: { discord: config.discord.enabled, ai: config.ai.enabled }, runtime: app.locals.integrationStatus?.() || null, ...(await repository.health()) });
    } catch (error) { next(error); }
  });

  app.get('/api/dashboard', async (_request, response, next) => {
    try { response.json(await repository.dashboard()); } catch (error) { next(error); }
  });

  app.post('/api/discord/sync', async (_request, response, next) => {
    try {
      if (!app.locals.discordSync) return response.status(503).json({ error: 'discord_sync_unavailable' });
      response.json(await app.locals.discordSync());
    } catch (error) { next(error); }
  });

  app.get('/api/market/quotes', async (request, response, next) => {
    try {
      if (!quoteService) return response.status(503).json({ error: 'longbridge_unavailable' });
      const symbols = String(request.query.symbols || '').split(',');
      response.json(await quoteService.getQuotes(symbols));
    } catch (error) { next(error); }
  });

  app.post('/api/signals/parse', async (request, response, next) => {
    try {
      if (typeof request.body?.text !== 'string' || !request.body.text.trim()) {
        return response.status(400).json({ error: 'text is required' });
      }
      const messageEvent = await repository.recordMessage({
        eventType: 'manual_test', channelId: 'manual', content: request.body.text.trim(), discordCreatedAt: new Date().toISOString()
      });
      let candidate = parseSignal(request.body.text);
      if (request.body.useAI === true && config.ai.enabled) {
        candidate = { ...(await parseSignalWithAI(request.body.text, config.ai)), rawText: request.body.text, reasons: ['AI 候选，必须经过规则与人工确认'] };
      }
      const portfolio = await repository.getPortfolio();
      const risk = evaluatePaperSignal({ signal: candidate, portfolio, config: config.risk });
      const record = await repository.recordSignal({ ...candidate, messageEventId: messageEvent.id, risk });
      broadcast({ type: 'signal_candidate', data: record });
      response.status(201).json(record);
    } catch (error) { next(error); }
  });

  app.post('/api/demo/reset', async (_request, response, next) => {
    try {
      if (!repository.reset) return response.status(409).json({ error: 'reset_only_available_in_memory_demo' });
      response.json(await repository.reset());
    } catch (error) { next(error); }
  });

  app.get('/api/events', (request, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();
    response.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
    sseClients.add(response);
    request.on('close', () => sseClients.delete(response));
  });

  function broadcast(event) {
    for (const client of sseClients) client.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  }

  app.locals.broadcast = broadcast;
  app.use(express.static(staticDir));
  app.get('/{*splat}', (_request, response) => response.sendFile(path.join(staticDir, 'index.html')));

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: 'internal_error', message: process.env.NODE_ENV === 'production' ? undefined : error.message });
  });

  return app;
}
