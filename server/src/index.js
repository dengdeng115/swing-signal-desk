import { loadConfig, validateEnabledIntegrations } from './config.js';
import { createApp } from './app.js';
import { LongbridgeQuoteService } from './services/longbridge-quotes.js';
import { MemoryRepository } from './db/memory-repository.js';
import { PostgresRepository } from './db/postgres-repository.js';
import { startDiscordBot } from './services/discord-bot.js';
import { createReplayRefreshScheduler } from './services/portfolio-replay-runner.js';

const config = loadConfig();
validateEnabledIntegrations(config);
const repository = config.databaseUrl
  ? new PostgresRepository(config.databaseUrl)
  : new MemoryRepository(config.risk.initialCapital);
const quoteService = new LongbridgeQuoteService();
const app = createApp({ config, repository, quoteService });
const replayScheduler = repository.pool
  ? createReplayRefreshScheduler({ pool: repository.pool, quoteService, onComplete: app.locals.broadcast })
  : null;
const server = app.listen(config.port, () => {
  console.log(`Swing Signal Desk listening on http://localhost:${config.port}`);
  console.log(`Storage: ${config.databaseUrl ? 'PostgreSQL' : 'memory demo'}`);
});

const discord = await startDiscordBot({
  config,
  repository,
  onEvent: app.locals.broadcast,
  onStrategyChanged: () => replayScheduler?.schedule('discord_strategy_update')
});
app.locals.discordSync = discord?.syncHistory;
app.locals.integrationStatus = () => ({
  discord: discord?.getStatus?.() || { gateway: config.discord.enabled ? 'starting' : 'disabled' },
  replay: replayScheduler?.status?.() || { running: false, pending: false }
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down`);
  if (discord) discord.destroy();
  server.close();
  if (repository.close) await repository.close();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
