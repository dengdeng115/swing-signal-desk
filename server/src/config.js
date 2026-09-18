import 'dotenv/config';

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const booleanFromEnv = (name, fallback = false) => {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return value.toLowerCase() === 'true';
};

export function loadConfig() {
  return {
    port: numberFromEnv('PORT', 8787),
    appOrigin: process.env.APP_ORIGIN || 'http://localhost:8787',
    databaseUrl: process.env.DATABASE_URL || '',
    discord: {
      enabled: booleanFromEnv('DISCORD_ENABLED'),
      token: process.env.DISCORD_BOT_TOKEN || '',
      channelIds: (process.env.DISCORD_CHANNEL_IDS || '').split(',').map((x) => x.trim()).filter(Boolean)
    },
    ai: {
      enabled: booleanFromEnv('AI_ENABLED'),
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || ''
    },
    risk: {
      initialCapital: numberFromEnv('INITIAL_CAPITAL', 1_000_000),
      maxGrossUtilization: numberFromEnv('MAX_GROSS_UTILIZATION', 0.70),
      maxSymbolWeight: numberFromEnv('MAX_SYMBOL_WEIGHT', 0.20),
      minCashReserve: numberFromEnv('MIN_CASH_RESERVE', 0.30),
      minAutoParseConfidence: numberFromEnv('MIN_AUTO_PARSE_CONFIDENCE', 0.85),
      maxSignalAgeSeconds: numberFromEnv('MAX_SIGNAL_AGE_SECONDS', 120)
    }
  };
}

export function validateEnabledIntegrations(config) {
  if (config.discord.enabled && (!config.discord.token || config.discord.channelIds.length === 0)) {
    throw new Error('DISCORD_ENABLED requires DISCORD_BOT_TOKEN and DISCORD_CHANNEL_IDS');
  }
  if (config.ai.enabled && (!config.ai.apiKey || !config.ai.model)) {
    throw new Error('AI_ENABLED requires OPENAI_API_KEY and OPENAI_MODEL');
  }
}
