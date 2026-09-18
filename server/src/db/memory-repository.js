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
    return { ...state, positions: state.portfolio.positions };
  }
  async getPortfolio() { return clone(this.state.portfolio); }

  async recordMessage(event) {
    const record = { id: crypto.randomUUID(), recordedAt: new Date().toISOString(), ...event };
    this.state.messages.push(record);
    return clone(record);
  }

  async recordSignal(signal) {
    const record = { id: crypto.randomUUID(), status: 'pending_review', createdAt: new Date().toISOString(), ...signal };
    this.state.signals.push(record);
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
