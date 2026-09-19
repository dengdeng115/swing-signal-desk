const PREFIX_PATTERN = /^@everyone\s*/i;
const AUTHOR_PATTERN = /^赵哥-股票[：:]\s*/;
const NUMBER_PATTERN = /\d{1,4}(?:\.\d+)?/g;
const SELL_START_PATTERN = /\d{1,4}(?:\.\d+)?\s*出/g;
const SYMBOL_PATTERN = /(?<![a-z])([a-z]{2,5})(?![a-z])/g;

const CHINESE_SYMBOLS = new Map([
  ['谷歌A', 'GOOGL']
]);

export function normalizeZhaoMessage(content) {
  return String(content || '')
    .replace(PREFIX_PATTERN, '')
    .replace(AUTHOR_PATTERN, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[。．]/g, '.')
    .replace(/，/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function fractionFromClause(text) {
  if (/全部|清仓|底仓/.test(text)) return 1;
  if (/一半|半仓/.test(text)) return 0.5;
  if (/三分之一/.test(text)) return 1 / 3;
  if (/6分之(?:一|1)|六分之一|6分之(?=常规仓)/.test(text)) return 1 / 6;
  return null;
}

function symbolFromClause(text) {
  for (const [label, symbol] of CHINESE_SYMBOLS) {
    const matchIndex = text.indexOf(label);
    if (matchIndex >= 0) return { symbol, symbolSource: 'mapped-label', needsReview: true, matchIndex, matchLength: label.length };
  }
  const matches = [...text.matchAll(SYMBOL_PATTERN)].filter((match) => !['CPI', 'PPI', 'BTC', 'QQQ', 'SPX'].includes(match[1].toUpperCase()));
  const tokens = matches.map((match) => match[1].toUpperCase());
  const unique = [...new Set(tokens)];
  if (unique.length !== 1) return { symbol: null, symbolSource: 'none', needsReview: true };
  const lastMatch = matches.filter((match) => match[1].toUpperCase() === unique[0]).at(-1);
  return { symbol: unique[0], symbolSource: 'ticker', needsReview: false, matchIndex: lastMatch.index, matchLength: lastMatch[0].length };
}

function actionSegments(text) {
  const starts = [...text.matchAll(SELL_START_PATTERN)].map((match) => match.index);
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length).trim());
}

function parseSellSegment(segment, message) {
  const actionAt = segment.indexOf('出');
  if (actionAt <= 0) return [];
  const exitPrice = Number(segment.slice(0, actionAt).trim());
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return [];

  const effective = segment.slice(0, segment.search(/保留|留着|继续拿/) >= 0
    ? segment.search(/保留|留着|继续拿/)
    : segment.length);
  const { symbol, symbolSource, needsReview, matchIndex, matchLength } = symbolFromClause(effective);
  if (!symbol) return [];

  const beforeSymbol = effective.slice(actionAt + 1, matchIndex);
  const entrySource = NUMBER_PATTERN.test(beforeSymbol)
    ? effective.slice(actionAt + 1, matchIndex + matchLength)
    : effective.slice(actionAt + 1);
  NUMBER_PATTERN.lastIndex = 0;
  const entries = [...entrySource.matchAll(NUMBER_PATTERN)]
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!entries.length) return [];

  const fraction = fractionFromClause(effective);
  return entries.map((entryPrice, entryIndex) => {
    const grossReturnPct = (exitPrice - entryPrice) / entryPrice * 100;
    return {
      action: 'sell',
      symbol,
      entryPrice,
      exitPrice,
      positionFraction: fraction,
      closedLeg: true,
      outcome: grossReturnPct > 0 ? 'win' : grossReturnPct < 0 ? 'loss' : 'flat',
      grossReturnPct: Number(grossReturnPct.toFixed(6)),
      extractionMethod: 'strict-explicit-pair',
      parserVersion: 'history-rules-v1',
      confidence: needsReview ? 0.82 : 0.97,
      reviewStatus: needsReview ? 'needs_review' : 'auto_included',
      notes: entryIndex > 0 ? '同一卖出消息包含多个明确成本批次；每个批次单独计一条交易腿。' : null,
      rawText: message
    };
  });
}

function parseBuy(text) {
  if (!/^\d{1,4}(?:\.\d+)?/.test(text)) return [];
  if (!/(?:加了|买入|买回|加回)/.test(text)) return [];
  const price = Number(text.match(/^\d{1,4}(?:\.\d+)?/)[0]);
  const { symbol, symbolSource, needsReview } = symbolFromClause(text);
  if (!symbol) return [];
  const isRebuy = /买回|加回/.test(text);
  return [{
    action: isRebuy ? 'rebuy' : 'buy',
    symbol,
    entryPrice: price,
    exitPrice: null,
    positionFraction: fractionFromClause(text),
    closedLeg: false,
    outcome: 'open',
    grossReturnPct: null,
    extractionMethod: isRebuy ? 'strict-rebuy' : 'strict-buy',
    parserVersion: 'history-rules-v1',
    confidence: needsReview ? 0.80 : 0.96,
    reviewStatus: needsReview ? 'needs_review' : 'auto_included',
    notes: isRebuy ? '这是买回/加回动作，不按卖出平仓统计。' : null,
    rawText: text,
    symbolSource
  }];
}

export function parseHistoricalTradeMessage(content) {
  const text = normalizeZhaoMessage(content);
  if (!text) return { normalizedText: text, events: [], unresolvedReason: 'empty' };

  const buyEvents = parseBuy(text);
  if (buyEvents.length) return { normalizedText: text, events: buyEvents, unresolvedReason: null };

  // Long commentary is intentionally excluded even if it contains example prices.
  if (text.length > 180 || !/^\d{1,4}(?:\.\d+)?\s*出/.test(text)) {
    const tradeLike = /买|加仓|加了|出|卖|止盈|止损|仓/.test(text);
    return { normalizedText: text, events: [], unresolvedReason: tradeLike ? 'trade_like_but_not_strict' : 'not_trade' };
  }

  const events = actionSegments(text).flatMap((segment) => parseSellSegment(segment, text));
  return {
    normalizedText: text,
    events,
    unresolvedReason: events.length ? null : 'trade_like_but_not_strict'
  };
}

export function summarizeHistoricalMessages(messages) {
  const seen = new Map();
  const rows = [];
  let tradeLikeUnresolved = 0;
  for (const message of messages) {
    const parsed = parseHistoricalTradeMessage(message.content);
    if (parsed.unresolvedReason === 'trade_like_but_not_strict') tradeLikeUnresolved += 1;
    const duplicateOf = seen.get(parsed.normalizedText) || null;
    if (!duplicateOf) seen.set(parsed.normalizedText, message.messageId);
    for (const [legIndex, event] of parsed.events.entries()) {
      rows.push({ ...event, legIndex, message, normalizedText: parsed.normalizedText, duplicateOf });
    }
  }
  const includedClosed = rows.filter((row) => row.closedLeg && !row.duplicateOf && row.reviewStatus === 'auto_included');
  const wins = includedClosed.filter((row) => row.outcome === 'win').length;
  const losses = includedClosed.filter((row) => row.outcome === 'loss').length;
  const flats = includedClosed.filter((row) => row.outcome === 'flat').length;
  const returns = includedClosed.map((row) => row.grossReturnPct).sort((a, b) => a - b);
  const median = returns.length ? (returns[Math.floor((returns.length - 1) / 2)] + returns[Math.ceil((returns.length - 1) / 2)]) / 2 : null;
  return {
    rows,
    metrics: {
      rawMessages: messages.length,
      parsedEvents: rows.length,
      closedLegs: includedClosed.length,
      wins,
      losses,
      flats,
      winRatePct: includedClosed.length ? Number((wins / includedClosed.length * 100).toFixed(2)) : null,
      medianReturnPct: median == null ? null : Number(median.toFixed(4)),
      averageReturnPct: returns.length ? Number((returns.reduce((sum, value) => sum + value, 0) / returns.length).toFixed(4)) : null,
      tradeLikeUnresolved,
      duplicateEvents: rows.filter((row) => row.duplicateOf).length,
      needsReview: rows.filter((row) => row.reviewStatus === 'needs_review').length
    }
  };
}
