const TICKER_PATTERN = /(?<![A-Z])\$?([A-Z]{1,5})(?:\.US)?(?![A-Z])/;
const ALPHA_TOKEN_PATTERN = /(?<![A-Za-z])\$?([A-Za-z]{2,10})(?:\.US)?(?![A-Za-z])/g;
const NUMBER_PATTERN = /(?:\$|价格|价位|到|在|附近|回踩|站稳|跌回|跌破|突破)?\s*(\d{1,4}(?:\.\d{1,2})?)/g;

const ACTION_PATTERNS = {
  sell: /清仓|减仓|止盈|卖出|落袋|出掉|砍仓/,
  buy: /买入|建仓|开仓|开一笔|接第一笔|加仓|低吸/,
  hold: /继续拿|持有|不动/
};

function firstNumber(text) {
  const matches = [...text.matchAll(NUMBER_PATTERN)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  return matches[0] ?? null;
}

function fractionFromText(text) {
  if (/清仓|全部卖|全仓卖/.test(text)) return 1;
  if (/半仓|一半|二分之一/.test(text)) return 0.5;
  if (/三分之一/.test(text)) return 1 / 3;
  if (/四分之一/.test(text)) return 0.25;
  const percent = text.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (percent) return Math.min(Number(percent[1]) / 100, 1);
  if (/第一笔|先开一笔|首笔/.test(text)) return 0.04;
  return null;
}

function actionFromText(text) {
  if (ACTION_PATTERNS.sell.test(text)) return 'sell';
  if (ACTION_PATTERNS.buy.test(text)) return 'buy';
  if (ACTION_PATTERNS.hold.test(text)) return 'hold';
  return 'note';
}

function detectedActions(text) {
  return Object.entries(ACTION_PATTERNS).filter(([, pattern]) => pattern.test(text)).map(([action]) => action);
}

function detectedSymbolTokens(text) {
  return [...new Set([...text.matchAll(ALPHA_TOKEN_PATTERN)].map((match) => match[1].toUpperCase()))];
}

function stopFromText(text) {
  const match = text.match(/止损(?:放|设|在)?\s*(\d{1,4}(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : null;
}

export function parseSignal(text, options = {}) {
  const normalized = String(text || '').trim().replace(/，/g, ',');
  const tickerMatch = normalized.match(TICKER_PATTERN);
  const symbol = tickerMatch?.[1] ?? null;
  const action = actionFromText(normalized);
  const price = firstNumber(symbol ? normalized.replace(tickerMatch[0], '') : normalized);
  const fraction = fractionFromText(normalized);
  const stopPrice = stopFromText(normalized);
  const conditional = /如果|若|站稳|跌破|突破|等回踩|再说|冲高别追|观察/.test(normalized);
  const actions = detectedActions(normalized);
  const symbolTokens = detectedSymbolTokens(normalized);
  const ambiguous = actions.length > 1 || symbolTokens.length > 1;
  const reasons = [];

  let confidence = 0.25;
  if (symbol) confidence += 0.25; else reasons.push('缺少股票代码');
  if (action !== 'note') confidence += 0.20; else reasons.push('缺少明确交易动作');
  if (price != null) confidence += 0.15; else reasons.push('缺少参考价格');
  if (fraction != null || action === 'hold') confidence += 0.15; else reasons.push('缺少明确仓位');
  if (conditional) {
    confidence -= 0.20;
    reasons.push('包含条件或观察性表达');
  }
  if (actions.length > 1) {
    confidence -= 0.35;
    reasons.push('检测到多个交易动作，必须拆分后人工确认');
  }
  if (symbolTokens.length > 1) {
    confidence -= 0.35;
    reasons.push('检测到多个或未验证的股票标识，必须人工确认');
  }

  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
  const executable = Boolean(symbol && ['buy', 'sell'].includes(action) && price != null && fraction != null && !conditional && !ambiguous);

  return {
    parser: options.parser || 'rules-v1.1',
    rawText: normalized,
    symbol,
    action,
    price,
    fraction,
    stopPrice,
    conditional,
    ambiguous,
    confidence,
    executable,
    reasons
  };
}
