import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { parseSignal } from '../core/signal-parser.js';
import { parseSignalWithAI } from './ai-parser.js';
import { evaluatePaperSignal } from '../core/risk-engine.js';

function serializeMessage(message) {
  return {
    messageId: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    authorId: message.author?.id || null,
    content: message.content || '',
    discordCreatedAt: message.createdAt?.toISOString() || null,
    rawPayload: {
      attachments: [...(message.attachments?.values?.() || [])].map((item) => ({ id: item.id, name: item.name, url: item.url })),
      embeds: message.embeds?.map((item) => item.toJSON()) || []
    }
  };
}

export async function startDiscordBot({ config, repository, onEvent = () => {}, onStrategyChanged = () => {} }) {
  if (!config.discord.enabled) return null;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.Message]
  });

  const status = {
    gateway: 'connecting',
    connectedAt: null,
    lastGatewayMessageAt: null,
    lastSyncAt: null,
    lastSyncScanned: 0,
    lastSyncNewMessages: 0,
    syncIntervalSeconds: config.discord.catchupIntervalSeconds,
    lastError: null
  };
  let syncing = null;

  async function record(eventType, incoming) {
    const message = incoming.partial && eventType !== 'delete' ? await incoming.fetch() : incoming;
    if (!isAllowedDiscordMessage(message, config.discord, eventType, client.user?.id)) return { accepted: false, isNew: false };

    const messageEvent = await repository.recordMessage({ eventType, ...serializeMessage(message) });
    if (eventType === 'create' && !messageEvent.isNew) return { accepted: true, isNew: false };
    if (eventType !== 'create') {
      onEvent({ type: 'discord_message_event', data: messageEvent });
      return { accepted: true, isNew: true, strategyLegs: 0 };
    }

    const strategyResult = repository.recordStrategyLegs
      ? await repository.recordStrategyLegs(messageEvent)
      : { inserted: 0 };

    let candidate = parseSignal(message.content);
    if (config.ai.enabled && (!candidate.executable || candidate.confidence < config.risk.minAutoParseConfidence)) {
      try {
        const aiCandidate = await parseSignalWithAI(message.content, config.ai);
        candidate = { ...aiCandidate, rawText: message.content, reasons: ['AI 候选，必须经过规则与人工确认'] };
      } catch (error) {
        await repository.recordAudit({ action: 'ai_parse_failed', entityType: 'discord_message_event', entityId: messageEvent.id, details: { message: error.message } });
      }
    }

    const portfolio = await repository.getPortfolio();
    const risk = evaluatePaperSignal({ signal: candidate, portfolio, config: config.risk, receivedAt: new Date(messageEvent.recordedAt || Date.now()) });
    const signal = await repository.recordSignal({ ...candidate, messageEventId: messageEvent.id, risk });
    onEvent({ type: 'signal_candidate', data: signal });
    if (strategyResult.inserted > 0) onStrategyChanged({ messageEvent, strategyResult });
    return { accepted: true, isNew: true, strategyLegs: strategyResult.inserted || 0 };
  }

  client.on('messageCreate', (message) => {
    status.lastGatewayMessageAt = new Date().toISOString();
    record('create', message).catch((error) => { status.lastError = error.message; console.error('Discord create handler failed', error); });
  });
  client.on('messageUpdate', (_oldMessage, newMessage) => record('update', newMessage).catch((error) => console.error('Discord update handler failed', error)));
  client.on('messageDelete', (message) => record('delete', message).catch((error) => console.error('Discord delete handler failed', error)));
  await client.login(config.discord.token);
  status.gateway = 'connected';
  status.connectedAt = new Date().toISOString();

  async function syncHistory({ force = false } = {}) {
    if (syncing) return syncing;
    const elapsed = status.lastSyncAt ? Date.now() - new Date(status.lastSyncAt).getTime() : Infinity;
    if (!force && elapsed < config.discord.catchupMinGapSeconds * 1000) {
      return { throttled: true, ...status };
    }
    syncing = (async () => {
      let scanned = 0;
      let newMessages = 0;
      let strategyLegs = 0;
      try {
        for (const subscription of config.discord.subscriptions) {
          const channel = await client.channels.fetch(subscription.channelId);
          if (!channel?.messages?.fetch) throw new Error(`Channel ${subscription.channelId} is not a readable text channel`);
          let cursor = await repository.latestDiscordMessageId(subscription);
          let keepGoing = true;
          while (keepGoing && scanned < config.discord.catchupMaxMessages) {
            const remaining = config.discord.catchupMaxMessages - scanned;
            const batch = await channel.messages.fetch({ limit: Math.min(100, remaining), ...(cursor ? { after: cursor } : {}) });
            const ordered = [...batch.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
            if (!ordered.length) break;
            for (const message of ordered) {
              scanned += 1;
              const result = await record('create', message);
              if (result.isNew) newMessages += 1;
              strategyLegs += result.strategyLegs || 0;
            }
            cursor = ordered.at(-1).id;
            keepGoing = ordered.length === Math.min(100, remaining);
          }
        }
        status.lastSyncAt = new Date().toISOString();
        status.lastSyncScanned = scanned;
        status.lastSyncNewMessages = newMessages;
        status.lastError = null;
        const result = { throttled: false, scanned, newMessages, strategyLegs, ...status };
        onEvent({ type: 'discord_sync_complete', data: result });
        return result;
      } catch (error) {
        status.lastError = error.message;
        throw error;
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  await syncHistory({ force: true });
  const interval = setInterval(() => syncHistory().catch((error) => console.error('Discord catch-up failed', error)), config.discord.catchupIntervalSeconds * 1000);
  interval.unref?.();
  return {
    client,
    syncHistory,
    getStatus: () => ({ ...status, syncing: Boolean(syncing) }),
    destroy: () => { clearInterval(interval); client.destroy(); }
  };
}

export function isAllowedDiscordMessage(message, discordConfig, eventType = 'create', currentBotUserId = null) {
  const subscriptions = discordConfig.subscriptions || [];
  const matchingScope = subscriptions.find((item) => item.guildId === message.guildId && item.channelId === message.channelId);
  if (!matchingScope) return false;
  if (eventType === 'delete' && !message.author?.id) return true;

  const authorId = message.author?.id;
  if (!authorId) return false;
  const isExplicitAuthor = matchingScope.authorIds.includes(authorId);

  // Some signal channels are relayed by a Discord Bot. Accept those messages
  // only when that exact Bot user ID is explicitly allowlisted. Wildcard
  // channel subscriptions remain human-only, and the collector never ingests
  // its own messages.
  if (message.author?.bot) {
    return authorId !== currentBotUserId && matchingScope.authorIds.length > 0 && isExplicitAuthor;
  }

  return matchingScope.authorIds.length === 0 || isExplicitAuthor;
}
