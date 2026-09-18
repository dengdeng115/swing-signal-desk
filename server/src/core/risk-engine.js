export function evaluatePaperSignal({ signal, portfolio, config, receivedAt = new Date(), now = new Date() }) {
  const reasons = [];
  const equity = portfolio.equity;
  const currentGross = portfolio.positions.reduce((sum, position) => sum + position.marketValue, 0);
  const currentPosition = portfolio.positions.find((position) => position.symbol === signal.symbol);
  const ageSeconds = Math.max(0, (now - receivedAt) / 1000);

  if (!signal.executable) reasons.push('指令不完整或包含条件');
  if (signal.confidence < config.minAutoParseConfidence) reasons.push('解析置信度低于阈值');
  if (ageSeconds > config.maxSignalAgeSeconds) reasons.push('消息超过允许时延');

  let requestedValue = 0;
  if (signal.action === 'buy' && signal.fraction != null) {
    requestedValue = equity * signal.fraction;
    if ((currentGross + requestedValue) / equity > config.maxGrossUtilization) reasons.push('将超过总资金利用率上限');
    const symbolValue = (currentPosition?.marketValue || 0) + requestedValue;
    if (symbolValue / equity > config.maxSymbolWeight) reasons.push('将超过单一股票仓位上限');
    if ((portfolio.cash - requestedValue) / equity < config.minCashReserve) reasons.push('将低于强制现金垫');
  }
  if (signal.action === 'sell' && !currentPosition) reasons.push('没有可减仓的模拟持仓');

  return {
    mode: 'paper_only',
    eligible: reasons.length === 0,
    requiresHumanConfirmation: true,
    requestedValue: Number(requestedValue.toFixed(2)),
    ageSeconds: Number(ageSeconds.toFixed(1)),
    reasons
  };
}
