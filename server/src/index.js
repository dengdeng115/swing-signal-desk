import { loadConfig, validateEnabledIntegrations } from './config.js';
import { createApp } from './app.js';
import { MemoryRepository } from './db/memory-repository.js';
import { PostgresRepository } from './db/postgres-repository.js';
import { startDiscordBot } from './services/discord-bot.js';

const config = loadConfig();
validateEnabledIntegrations(config);
const repository = config.databaseUrl
  ? new PostgresRepository(config.databaseUrl)
  : new MemoryRepository(config.risk.initialCapital);
const app = createApp({ config, repository });
const server = app.listen(config.port, () => {
  console.log(`Swing Signal Desk listening on http://localhost:${config.port}`);
  console.log(`Storage: ${config.databaseUrl ? 'PostgreSQL' : 'memory demo'}`);
});

const discord = await startDiscordBot({ config, repository, onEvent: app.locals.broadcast });

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down`);
  if (discord) discord.destroy();
  server.close();
  if (repository.close) await repository.close();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
