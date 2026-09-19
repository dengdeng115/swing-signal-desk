import { parseHistoricalTradeMessage } from '../core/historical-trade-parser.js';

const clone = (value) => structuredClone(value);

function seedState(initialCapital) {
  return {
    portfolio: {
      name: '默认模拟组合',
      initialCapital,
      cash: 375_410,
      realizedPnl: 38_420,
      equity: 1_038_420,
      positions: [
        { symbol: 'NVDA', quantity: 900, averageCost: 207.87, lastPrice: 220, marketValue: 198_000 },
        { symbol: 'TSLA', quantity: 420, averageCost: 416.95, lastPrice: 432, marketValue: 181_440 },
        { symbol: 'AMD', quantity: 430, averageCost: 202, lastPrice: 199, marketValue: 85_570 }
      ]
    },
    messages: [],
    signals: [],
    messageReviews: [],
    audit: []
  };
}

export class MemoryRepository {
  constructor(initialCapital = 1_000_000) {
    this.initialCapital = initialCapital;
    this.state = seedState(initialCapital);
  }

  async health() { return { storage: 'memory', ok: true }; }
  async dashboard() {
    const state = clone(this.state);
    const reviewed = new Set(state.messageReviews.map((row) => row.messageEventId));
    const messages = state.messages.filter((row) => row.eventType === 'create').sort((a, b) => new Date(b.discordCreatedAt) - new Date(a.discordCreatedAt));
    const liveMessages = messages.map((row) => {
      const parsed = parseHistoricalTradeMessage(row.content);
      return { id: row.id, messageId: row.messageId, createdAt: row.discordCreatedAt, receivedAt: row.recordedAt, content: row.content,
        kind: parsed.events.length ? 'trade' : parsed.unresolvedReason === 'trade_like_but_not_strict' ? 'needs_review' : 'commentary', actionCount: parsed.events.length,
        isFresh: Date.now() - new Date(row.discordCreatedAt).getTime() <= 5 * 60_000, review: state.messageReviews.find((review) => review.messageEventId === row.id) || null };
    });
    return { ...state, positions: state.portfolio.positions, strategyReview: null, accountReplay: null,
      liveDesk: { generatedAt: new Date().toISOString(), recent24hCount: liveMessages.filter((row) => Date.now() - new Date(row.createdAt).getTime() <= 86400_000).length,
        recent24hTradeCount: 0, pendingReviewCount: liveMessages.filter((row) => row.kind === 'needs_review' && !reviewed.has(row.id)).length,
        reviewedCount: reviewed.size, latestMessages: liveMessages.slice(0, 30), latestActions: [],
        reviewQueue: liveMessages.filter((row) => row.kind === 'needs_review' && !reviewed.has(row.id)).slice(0, 100) } };
  }
  async getPortfolio() { return clone(this.state.portfolio); }

  async recordMessage(event) {
    if (event.eventType === 'create' && event.messageId) {
      const existing = this.state.messages.find((item) => item.eventType === 'create' && item.messageId === event.messageId);
      if (existing) return { ...clone(existing), isNew: false };
    }
    const record = { id: crypto.randomUUID(), recordedAt: new Date().toISOString(), ...event };
    this.state.messages.push(record);
    return { ...clone(record), isNew: true };
  }

  async latestDiscordMessageId({ guildId, channelId }) {
    return this.state.messages.filter((item) => item.eventType === 'create' && item.guildId === guildId && item.channelId === channelId)
      .sort((a, b) => new Date(b.discordCreatedAt) - new Date(a.discordCreatedAt))[0]?.messageId || null;
  }

  async recordStrategyLegs() { return { inserted: 0, unresolvedReason: null }; }

  async recordSignal(signal) {
    const record = { id: crypto.randomUUID(), status: 'pending_review', createdAt: new Date().toISOString(), ...signal };
    this.state.signals.push(record);
    return clone(record);
  }

  async getMessageHistory({ page = 1, pageSize = 50 } = {}) {
    const items = this.state.messages.filter((row) => row.eventType === 'create').sort((a, b) => new Date(b.discordCreatedAt) - new Date(a.discordCreatedAt));
    const start = (page - 1) * pageSize;
    return { page, pageSize, total: items.length, items: clone(items.slice(start, start + pageSize).map((row) => {
      const parsed = parseHistoricalTradeMessage(row.content);
      return { ...row, kind: parsed.events.length ? 'trade' : parsed.unresolvedReason === 'trade_like_but_not_strict' ? 'needs_review' : 'commentary', actions: [] };
    })) };
  }

  async recordMessageReview({ messageEventId, decision, reviewer, reason = null }) {
    const message = this.state.messages.find((row) => row.id === messageEventId && row.eventType === 'create');
    if (!message || parseHistoricalTradeMessage(message.content).unresolvedReason !== 'trade_like_but_not_strict') return null;
    const record = { id: crypto.randomUUID(), messageEventId, decision, reviewer, reason, createdAt: new Date().toISOString() };
    this.state.messageReviews.push(record);
    this.state.audit.push({ id: crypto.randomUUID(), actorType: 'human', actorId: reviewer, action: 'message_reviewed', entityType: 'discord_message_event', entityId: messageEventId, details: { decision, reason }, createdAt: record.createdAt });
    return clone(record);
  }

  async recordAudit(event) {
    this.state.audit.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...event });
  }

  async reset() {
    this.state = seedState(this.initialCapital);
    return this.dashboard();
  }
}
