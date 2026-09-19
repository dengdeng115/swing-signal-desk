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

function discordSubscriptionsFromEnv() {
  const raw = process.env.DISCORD_SUBSCRIPTIONS_JSON;
  if (raw && raw !== '[]') {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('DISCORD_SUBSCRIPTIONS_JSON must be an array');
    return parsed.map((item) => ({
      guildId: String(item.guildId || ''),
      channelId: String(item.channelId || ''),
      authorIds: Array.isArray(item.authorIds) ? item.authorIds.map(String) : []
    }));
  }

  const guildId = process.env.DISCORD_GUILD_ID || '';
  const channelIds = (process.env.DISCORD_CHANNEL_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const authorIds = (process.env.DISCORD_AUTHOR_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return channelIds.map((channelId) => ({ guildId, channelId, authorIds }));
}

export function loadConfig() {
  return {
    port: numberFromEnv('PORT', 8787),
    appOrigin: process.env.APP_ORIGIN || 'http://localhost:8787',
    databaseUrl: process.env.DATABASE_URL || '',
    discord: {
      enabled: booleanFromEnv('DISCORD_ENABLED'),
      token: process.env.DISCORD_BOT_TOKEN || '',
      guildId: process.env.DISCORD_GUILD_ID || '',
      channelIds: (process.env.DISCORD_CHANNEL_IDS || '').split(',').map((x) => x.trim()).filter(Boolean),
      authorIds: (process.env.DISCORD_AUTHOR_IDS || '').split(',').map((x) => x.trim()).filter(Boolean),
      subscriptions: discordSubscriptionsFromEnv(),
      catchupIntervalSeconds: numberFromEnv('DISCORD_CATCHUP_INTERVAL_SECONDS', 60),
      catchupMinGapSeconds: numberFromEnv('DISCORD_CATCHUP_MIN_GAP_SECONDS', 30),
      catchupMaxMessages: numberFromEnv('DISCORD_CATCHUP_MAX_MESSAGES', 1000)
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
  if (config.discord.enabled) {
    if (!config.discord.token || config.discord.subscriptions.length === 0) {
      throw new Error('DISCORD_ENABLED requires DISCORD_BOT_TOKEN and at least one Discord subscription');
    }
    if (config.discord.subscriptions.some((item) => !item.guildId || !item.channelId)) {
      throw new Error('Every Discord subscription requires guildId and channelId');
    }
  }
  if (config.ai.enabled && (!config.ai.apiKey || !config.ai.model)) {
    throw new Error('AI_ENABLED requires OPENAI_API_KEY and OPENAI_MODEL');
  }
}
