import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SYMBOL_PATTERN = /^[A-Z]{1,5}$/;

function mapQuote(item) {
  return {
    symbol: String(item.symbol || '').replace(/\.US$/, ''),
    marketSymbol: item.symbol,
    last: Number(item.last),
    changePct: Number(item.change_percentage),
    status: item.status,
    preMarket: item.pre_market ? { last: Number(item.pre_market.last), timestamp: item.pre_market.timestamp } : null,
    postMarket: item.post_market ? { last: Number(item.post_market.last), timestamp: item.post_market.timestamp } : null,
    overnight: item.overnight ? { last: Number(item.overnight.last), timestamp: item.overnight.timestamp } : null
  };
}

export class LongbridgeQuoteService {
  constructor({ ttlMs = 30_000 } = {}) {
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  async getQuotes(requestedSymbols) {
    const symbols = [...new Set(requestedSymbols.map((value) => String(value).toUpperCase()).filter((value) => SYMBOL_PATTERN.test(value)))].slice(0, 20);
    if (!symbols.length) return { source: 'longbridge', receivedAt: new Date().toISOString(), quotes: [] };
    const key = symbols.sort().join(',');
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.cachedAt < this.ttlMs) return cached.payload;
    const { stdout } = await execFileAsync('longbridge', ['quote', ...symbols.map((symbol) => `${symbol}.US`), '--format', 'json'], {
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const payload = { source: 'longbridge', receivedAt: new Date().toISOString(), quotes: JSON.parse(stdout).map(mapQuote) };
    this.cache.set(key, { cachedAt: Date.now(), payload });
    return payload;
  }
}
