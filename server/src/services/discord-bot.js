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

export async function startDiscordBot({ config, repository, onEvent = () => {} }) {
  if (!config.discord.enabled) return null;

  const allowedChannels = new Set(config.discord.channelIds);
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.Message]
  });

  async function record(eventType, incoming) {
    const message = incoming.partial && eventType !== 'delete' ? await incoming.fetch() : incoming;
    if (!allowedChannels.has(message.channelId) || message.author?.bot) return;

    const messageEvent = await repository.recordMessage({ eventType, ...serializeMessage(message) });
    if (eventType !== 'create') {
      onEvent({ type: 'discord_message_event', data: messageEvent });
      return;
    }

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
  }

  client.on('messageCreate', (message) => record('create', message).catch((error) => console.error('Discord create handler failed', error)));
  client.on('messageUpdate', (_oldMessage, newMessage) => record('update', newMessage).catch((error) => console.error('Discord update handler failed', error)));
  client.on('messageDelete', (message) => record('delete', message).catch((error) => console.error('Discord delete handler failed', error)));
  await client.login(config.discord.token);
  return client;
}
