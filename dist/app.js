const state = {
  review: null, replay: null, filter: 'all', executionFilter: 'filled',
  visible: 50, executionVisible: 50, sort: ['closedLegs', 'desc'], chartPoints: []
};

const PUBLIC_SNAPSHOT = {
  mode: 'public_aggregate_snapshot', periodStart: '2026-08-18T16:00:00.000Z', periodEnd: '2026-09-19T05:26:36.357Z',
  metrics: { rawMessages: 629, parsedEvents: 425, closedLegs: 229, wins: 211, losses: 12, flats: 6, winRatePct: 92.14, medianReturnPct: 2.8425, tradeLikeUnresolved: 67 },
  coverage: { rawMessages: 629, parsedEvents: 425, includedClosedLegs: 229, unresolvedTradeLike: 67, duplicatesExcluded: 40, needsReview: 7 },
  dailyActivity: [['08-19',34],['08-20',31],['08-21',35],['08-24',16],['08-25',20],['08-26',16],['08-27',23],['08-28',14],['08-29',7],['08-31',5],['09-01',21],['09-02',25],['09-03',57],['09-04',27],['09-08',62],['09-09',12],['09-10',39],['09-11',29],['09-14',46],['09-15',6],['09-16',18],['09-17',76],['09-18',10]].map(([date,messages]) => ({ date: `2026-${date}`, messages })),
  bySymbol: [], legs: []
};

const PUBLIC_REPLAY = {
  strategyVersion: 'finite-capital-v1', periodStart: PUBLIC_SNAPSHOT.periodStart, periodEnd: PUBLIC_SNAPSHOT.periodEnd,
  assumptions: { initialCapital: 1_000_000, maxGrossUtilization: 0.70, maxSymbolWeight: 0.12, regularPositionWeight: 0.12, defaultTrancheFraction: 1 / 6, slippageBps: 10, feeBps: 2 },
  summary: { initialCapital: 1_000_000, finalEquity: 1_081_287.4916, cash: 584_661.7636, marketValue: 496_625.728, realizedPnl: 65_845.1376, unrealizedPnl: 15_442.354, totalReturnPct: 8.128749, maxDrawdownPct: -2.325577, peakUtilizationPct: 70.00216, totalFees: 957.7693, filledBuys: 148, filledSells: 203, skippedRisk: 4, openPositions: 13, skippedReview: 13, skippedUnmatched: 57 },
  curve: [
    ['2026-08-18T16:00:00Z',1000000,0,0],['2026-08-19T15:54:46Z',998980.35,-0.101965,-0.101965],['2026-08-20T14:32:09Z',1003938.68,0.393868,0],['2026-08-21T15:18:38Z',1005574.65,0.557465,-0.531801],['2026-08-24T15:58:36Z',1006002.13,0.600213,-0.489516],['2026-08-25T15:41:23Z',1012500.50,1.25005,0],['2026-08-26T14:09:13Z',1016899.71,1.689971,0],['2026-08-27T15:23:12Z',1020858.17,2.085817,-0.098291],['2026-08-28T16:47:33Z',1013951.45,1.395145,-0.774186],['2026-08-31T14:31:29Z',1014892.82,1.489282,-0.682063],['2026-09-01T15:48:05Z',1011893.66,1.189366,-0.975563],['2026-09-02T14:36:37Z',1005814.63,0.581463,-1.57046],['2026-09-03T15:44:33Z',1027683.85,2.768385,0],['2026-09-04T14:16:03Z',1045063.05,4.506305,0],['2026-09-08T15:12:44Z',1049666.20,4.96662,-0.150213],['2026-09-09T15:29:35Z',1047877.28,4.787728,-0.320385],['2026-09-10T14:55:09Z',1048678.18,4.867818,-0.244198],['2026-09-11T14:56:37Z',1054162.44,5.416244,-0.095615],['2026-09-14T15:43:50Z',1040329.81,4.032981,-1.406551],['2026-09-15T13:40:56Z',1037369.02,3.736902,-1.68715],['2026-09-16T14:17:26Z',1045409.72,4.540972,-0.925122],['2026-09-17T15:46:17Z',1059075.59,5.907559,-0.210385],['2026-09-18T14:05:02Z',1067179.88,6.717988,-0.180148],['2026-09-19T06:08:55Z',1081287.49,8.128749,0]
  ].map(([occurredAt,equity,returnPct,drawdownPct], sequence) => ({ sequence, occurredAt, equity, returnPct, drawdownPct })),
  events: [], positions: []
};

const $ = (selector) => document.querySelector(selector);
const number = (value, digits = 0) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
const pct = (value, digits = 2) => value == null ? '—' : `${value >= 0 ? '+' : ''}${number(value, digits)}%`;
const money = (value, digits = 2) => value == null ? '—' : `$${number(value, digits)}`;
const compactMoney = (value) => value == null ? '—' : new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(value);
const dateTime = (value) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function toast(text) { const el = $('#toast'); el.textContent = text; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3000); }

function renderSummary(review, replay) {
  const m = review.metrics;
  const r = replay.summary;
  $('#periodText').textContent = `${dateTime(review.periodStart)} — ${dateTime(review.periodEnd)} · 已包含最后一晚消息`;
  $('#accountGrowth').textContent = pct(r.totalReturnPct);
  $('#accountGrowth').className = r.totalReturnPct >= 0 ? 'positive' : 'negative';
  $('#growthFormula').textContent = `${compactMoney(r.initialCapital)} → ${compactMoney(r.finalEquity)}`;
  $('#growthHeadline').textContent = `有限资金回放：账户本月${r.totalReturnPct >= 0 ? '增长' : '回撤'} ${number(Math.abs(r.totalReturnPct), 2)}%。`;
  $('#finalEquity').textContent = compactMoney(r.finalEquity);
  $('#realizedPnl').textContent = compactMoney(r.realizedPnl);
  $('#realizedPnl').className = r.realizedPnl >= 0 ? 'positive' : 'negative';
  $('#winRate').textContent = `${number(m.winRatePct, 2)}%`;
  $('#winFormula').textContent = `${m.wins} 盈 / ${m.losses} 亏 / ${m.flats} 持平`;
  $('#maxDrawdown').textContent = pct(r.maxDrawdownPct);
  $('#maxDrawdown').className = r.maxDrawdownPct < 0 ? 'negative' : '';
}

function chartPath(points) { return points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '); }

function renderEquityChart(replay) {
  const svg = $('#equityChart');
  const rows = replay.curve || [];
  if (rows.length < 2) { svg.innerHTML = '<text x="500" y="165" text-anchor="middle" class="chart-empty">暂无账户曲线</text>'; return; }
  const width = 1000; const height = 330; const left = 70; const right = 22; const top = 24; const bottom = 48;
  const times = rows.map((row) => new Date(row.occurredAt).getTime());
  const values = rows.map((row) => Number(row.equity));
  const minTime = Math.min(...times); const maxTime = Math.max(...times);
  const rawMin = Math.min(...values); const rawMax = Math.max(...values); const pad = Math.max((rawMax - rawMin) * 0.14, 2500);
  const minValue = rawMin - pad; const maxValue = rawMax + pad;
  const x = (time) => left + (time - minTime) / Math.max(1, maxTime - minTime) * (width - left - right);
  const y = (value) => top + (maxValue - value) / (maxValue - minValue) * (height - top - bottom);
  const points = rows.map((row) => ({ ...row, x: x(new Date(row.occurredAt).getTime()), y: y(Number(row.equity)) }));
  state.chartPoints = points;
  const path = chartPath(points);
  const area = `${path} L${points.at(-1).x},${height - bottom} L${points[0].x},${height - bottom} Z`;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = minValue + (maxValue - minValue) * (4 - index) / 4;
    const gy = top + (height - top - bottom) * index / 4;
    return `<line x1="${left}" x2="${width - right}" y1="${gy}" y2="${gy}" class="chart-grid"/><text x="${left - 12}" y="${gy + 4}" text-anchor="end" class="chart-label">${compactMoney(value)}</text>`;
  }).join('');
  const labelIndexes = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const timeLabels = labelIndexes.map((index) => `<text x="${points[index].x}" y="${height - 17}" text-anchor="${index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}" class="chart-label">${dateTime(points[index].occurredAt).slice(0, 5)}</text>`).join('');
  const markers = points.filter((point) => point.eventSide === 'buy' || point.eventSide === 'sell').map((point) => `<circle cx="${point.x}" cy="${point.y}" r="2.5" class="trade-marker ${point.eventSide}"/>`).join('');
  svg.innerHTML = `<defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#43efbd" stop-opacity=".26"/><stop offset="1" stop-color="#43efbd" stop-opacity="0"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>${grid}<path d="${area}" class="equity-area"/><path id="equityPath" d="${path}" class="equity-line"/>${markers}${timeLabels}<line id="chartCursor" x1="0" x2="0" y1="${top}" y2="${height - bottom}" class="chart-cursor" visibility="hidden"/><circle id="chartCursorPoint" cx="0" cy="0" r="5" class="chart-cursor-point" visibility="hidden"/><rect x="${left}" y="${top}" width="${width - left - right}" height="${height - top - bottom}" class="chart-hit"/>`;
  const line = $('#equityPath');
  const length = line.getTotalLength(); line.style.strokeDasharray = length; line.style.strokeDashoffset = length;
  requestAnimationFrame(() => { line.style.strokeDashoffset = 0; });

  const r = replay.summary;
  const cashPct = r.cash / r.finalEquity * 100;
  $('#unrealizedPnl').textContent = compactMoney(r.unrealizedPnl);
  $('#unrealizedPnl').className = r.unrealizedPnl >= 0 ? 'positive' : 'negative';
  $('#peakUtilization').textContent = `${number(r.peakUtilizationPct, 1)}%`;
  $('#fillCounts').textContent = `${r.filledBuys} / ${r.filledSells}`;
  $('#unmatchedCount').textContent = number(r.skippedUnmatched);
  $('#cashPct').textContent = `${number(cashPct, 1)}%`;
  $('#utilizationRing').style.setProperty('--cash-angle', `${cashPct * 3.6}deg`);
}

function handleChartMove(event) {
  if (!state.chartPoints.length) return;
  const rect = $('#equityChart').getBoundingClientRect();
  const viewX = (event.clientX - rect.left) / rect.width * 1000;
  const point = state.chartPoints.reduce((best, item) => Math.abs(item.x - viewX) < Math.abs(best.x - viewX) ? item : best, state.chartPoints[0]);
  $('#chartCursor').setAttribute('x1', point.x); $('#chartCursor').setAttribute('x2', point.x); $('#chartCursor').setAttribute('visibility', 'visible');
  $('#chartCursorPoint').setAttribute('cx', point.x); $('#chartCursorPoint').setAttribute('cy', point.y); $('#chartCursorPoint').setAttribute('visibility', 'visible');
  const tip = $('#chartTooltip'); tip.hidden = false; tip.innerHTML = `<b>${pct(point.returnPct)}</b><span>${money(point.equity, 0)}</span><small>${dateTime(point.occurredAt)}${point.eventSide ? ` · ${point.eventSide === 'buy' ? '买入' : point.eventSide === 'sell' ? '卖出' : '估值'}` : ''}</small>`;
  tip.style.left = `${Math.min(rect.width - 150, Math.max(8, event.clientX - rect.left + 12))}px`; tip.style.top = `${Math.max(8, event.clientY - rect.top - 75)}px`;
}

function renderPositions(replay) {
  const rows = replay.positions || [];
  $('#positionRows').innerHTML = rows.length ? rows.map((row) => `<tr><td><b class="ticker">${escapeHtml(row.symbol)}</b></td><td>${number(row.quantity)}</td><td>${money(row.averageCost)}</td><td>${money(row.markPrice)}</td><td>${money(row.marketValue, 0)}</td><td class="${row.unrealizedPnl >= 0 ? 'positive' : 'negative'}">${money(row.unrealizedPnl, 0)}</td><td><span class="source-badge ${row.markSource}">${row.markSource === 'longbridge' ? '长桥当前价' : '最近信号价'}</span></td></tr>`).join('') : '<tr><td colspan="7">公开页面不展示逐标的持仓；请在本机后端查看。</td></tr>';
}

function executionLabel(event) {
  if (event.status === 'skipped_unmatched') return '无本月买入批次';
  if (event.status === 'skipped_review') return '待复核 / 重复';
  if (event.status === 'skipped_risk') return '触发资金上限';
  return '已模拟成交';
}

function renderExecution() {
  let rows = state.replay.events || [];
  if (state.executionFilter === 'filled') rows = rows.filter((row) => row.status === 'filled');
  if (state.executionFilter === 'buy') rows = rows.filter((row) => row.side === 'buy' && row.status === 'filled');
  if (state.executionFilter === 'sell') rows = rows.filter((row) => row.side === 'sell' && row.status === 'filled');
  if (state.executionFilter === 'skipped') rows = rows.filter((row) => row.status !== 'filled');
  const visible = rows.slice(0, state.executionVisible);
  $('#executionRows').innerHTML = visible.length ? visible.map((row) => `<tr class="${row.status === 'filled' ? '' : 'dim'}"><td>${dateTime(row.occurredAt)}</td><td><span class="side ${row.side}">${row.side === 'buy' ? '买入' : row.side === 'sell' ? '卖出' : '跳过'}</span></td><td><b class="ticker">${escapeHtml(row.symbol)}</b></td><td>${number(row.quantity)}</td><td>${money(row.signalPrice)}</td><td>${money(row.fillPrice)}</td><td>${money(row.fees)}</td><td class="${row.realizedPnl > 0 ? 'positive' : row.realizedPnl < 0 ? 'negative' : ''}">${row.side === 'sell' ? money(row.realizedPnl) : '—'}</td><td>${money(row.equityAfter, 0)}</td><td><span class="status ${row.status}">${executionLabel(row)}</span></td></tr>`).join('') : '<tr><td colspan="10">逐笔跟单流水仅在连接本机数据库后显示，公开页面只保留聚合曲线。</td></tr>';
  $('#executionCount').textContent = `显示 ${visible.length} / ${rows.length} 条处理记录`;
  $('#showMoreExecution').hidden = visible.length >= rows.length;
}

function renderActivity(rows) {
  const max = Math.max(...rows.map((row) => row.messages), 1);
  $('#activityChart').innerHTML = rows.map((row) => `<div class="day" title="${escapeHtml(row.date)} · ${row.messages} 条"><i style="height:${Math.max(8, row.messages / max * 100)}%"></i><span>${escapeHtml(row.date.slice(5).replace('-', '/'))}</span><b>${row.messages}</b></div>`).join('');
}

function renderCoverage(review) {
  const c = review.coverage;
  const items = [['原始消息', c.rawMessages, 100],['解析出的操作事件', c.parsedEvents, c.parsedEvents / c.rawMessages * 100],['纳入胜率的已完成交易腿', c.includedClosedLegs, c.includedClosedLegs / c.rawMessages * 100],['待人工理解的交易类消息', c.unresolvedTradeLike, c.unresolvedTradeLike / c.rawMessages * 100]];
  $('#coverageFunnel').innerHTML = items.map(([label, value, width], index) => `<div><span>${label}<b>${value}</b></span><em><i style="width:${Math.max(width, 4)}%"></i></em>${index === 2 ? '<small>胜率分母</small>' : ''}</div>`).join('') + `<p>另排除重复操作事件 ${c.duplicatesExcluded} 条；中文名称映射等待复核 ${c.needsReview} 条。</p>`;
}

function renderSymbols() {
  const [key, direction] = state.sort;
  const rows = [...state.review.bySymbol].sort((a, b) => direction === 'asc' ? String(a[key]).localeCompare(String(b[key]), 'zh-CN', { numeric: true }) : String(b[key]).localeCompare(String(a[key]), 'zh-CN', { numeric: true }));
  $('#symbolTable tbody').innerHTML = rows.length ? rows.map((row) => `<tr><td><b class="ticker">${escapeHtml(row.symbol)}</b></td><td>${row.closedLegs}</td><td class="positive">${row.wins}</td><td class="negative">${row.losses}</td><td><div class="rate"><i style="width:${row.winRatePct}%"></i><span>${number(row.winRatePct, 1)}%</span></div></td><td class="${row.averageReturnPct >= 0 ? 'positive' : 'negative'}">${pct(row.averageReturnPct)}</td></tr>`).join('') : '<tr><td colspan="6">逐标的统计只在连接本地数据库后显示。</td></tr>';
}

function actionLabel(action) { return action === 'sell' ? '卖出' : action === 'rebuy' ? '加回' : '买入'; }
function reviewLabel(row) { if (row.analysisIncluded) return '已纳入'; if (row.reviewStatus === 'needs_review') return '待复核'; if (row.reviewStatus === 'excluded_duplicate') return '重复排除'; return '未配对'; }
function renderLedger() {
  let rows = state.review.legs;
  if (state.filter === 'sell') rows = rows.filter((row) => row.action === 'sell');
  if (state.filter === 'buy') rows = rows.filter((row) => row.action !== 'sell');
  if (state.filter === 'review') rows = rows.filter((row) => row.reviewStatus === 'needs_review');
  const visible = rows.slice(0, state.visible);
  $('#ledgerRows').innerHTML = visible.length ? visible.map((row) => `<tr class="${row.analysisIncluded ? '' : 'dim'}"><td>${dateTime(row.occurredAt)}</td><td><span class="side ${row.action}">${actionLabel(row.action)}</span></td><td><b class="ticker">${escapeHtml(row.symbol)}</b></td><td>${money(row.entryPrice)}</td><td>${money(row.exitPrice)}</td><td>${row.positionFraction == null ? '未说明' : `${number(row.positionFraction * 100, 1)}%`}</td><td class="${row.returnPct > 0 ? 'positive' : row.returnPct < 0 ? 'negative' : ''}">${pct(row.returnPct)}</td><td><span class="status ${row.reviewStatus}">${reviewLabel(row)}</span></td><td><button class="message" data-message="${escapeHtml(row.content)}">查看原文</button></td></tr>`).join('') : '<tr><td colspan="9">操作价格与频道原文仅在本地后端显示，不进入公开静态页面。</td></tr>';
  $('#ledgerCount').textContent = `显示 ${visible.length} / ${rows.length} 条操作事件`;
  $('#showMore').hidden = visible.length >= rows.length;
}

function sessionQuote(quote) {
  const sessions = [['盘后', quote.postMarket], ['盘前', quote.preMarket], ['夜盘', quote.overnight]].filter(([, value]) => value?.timestamp).sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp));
  return sessions[0] || ['常规盘', { last: quote.last, timestamp: null }];
}

async function loadQuotes() {
  if (!state.review) return;
  const positionSymbols = (state.replay?.positions || []).slice(0, 6).map((row) => row.symbol);
  const symbols = (positionSymbols.length ? positionSymbols : state.review.bySymbol.slice(0, 6).map((row) => row.symbol)).join(',');
  if (!symbols) { $('#quoteList').innerHTML = '<div class="empty">长桥实时行情仅在本地服务提供。</div>'; return; }
  $('#quoteList').innerHTML = '<div class="empty">正在读取长桥行情…</div>';
  try {
    const response = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbols)}`);
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    $('#quoteList').innerHTML = data.quotes.map((quote) => { const [session, live] = sessionQuote(quote); return `<div><b>${escapeHtml(quote.symbol)}</b><strong>$${number(live.last, 2)}</strong><span class="${quote.changePct >= 0 ? 'positive' : 'negative'}">${pct(quote.changePct)}</span><small>${session}${live.timestamp ? ` · ${dateTime(live.timestamp)}` : ''}</small></div>`; }).join('');
    $('#quoteTime').textContent = `长桥读取于 ${dateTime(data.receivedAt)}；盘前/盘后与常规盘分开标记。`;
  } catch { $('#quoteList').innerHTML = '<div class="empty">长桥暂不可用；历史回放仍保留上次估值。</div>'; }
}

function renderAll(review, replay) {
  state.review = review; state.replay = replay;
  renderSummary(review, replay); renderEquityChart(replay); renderPositions(replay); renderExecution();
  renderActivity(review.dailyActivity); renderCoverage(review); renderSymbols(); renderLedger();
}

async function loadDashboard() {
  try {
    const response = await fetch('/api/dashboard', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('backend unavailable');
    const data = await response.json();
    if (!data.strategyReview || !data.accountReplay) throw new Error('history unavailable');
    $('#connectionTitle').textContent = '本地数据库已连接';
    $('#connectionDetail').textContent = `PostgreSQL · ${data.strategyReview.metrics.rawMessages} 条原始消息 · 跟单回放已更新`;
    renderAll(data.strategyReview, data.accountReplay);
    await loadQuotes();
  } catch {
    $('#connectionTitle').textContent = '公开聚合快照';
    $('#connectionDetail').textContent = '曲线可看 · 原文与逐笔保持私密';
    renderAll(PUBLIC_SNAPSHOT, PUBLIC_REPLAY);
    $('#quoteList').innerHTML = '<div class="empty">长桥实时行情仅在本地服务提供。</div>';
    toast('当前显示公开聚合回放；逐笔买卖与频道原文未公开。');
  }
}

$('#refreshButton').addEventListener('click', () => { state.visible = 50; state.executionVisible = 50; loadDashboard(); });
$('#quoteRefresh').addEventListener('click', loadQuotes);
$('#showMore').addEventListener('click', () => { state.visible += 50; renderLedger(); });
$('#showMoreExecution').addEventListener('click', () => { state.executionVisible += 50; renderExecution(); });
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-filter]').forEach((item) => item.classList.remove('active')); button.classList.add('active'); state.filter = button.dataset.filter; state.visible = 50; renderLedger(); }));
document.querySelectorAll('[data-execution-filter]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-execution-filter]').forEach((item) => item.classList.remove('active')); button.classList.add('active'); state.executionFilter = button.dataset.executionFilter; state.executionVisible = 50; renderExecution(); }));
$('#symbolTable thead').addEventListener('click', (event) => { const th = event.target.closest('[data-sort]'); if (!th || !state.review) return; state.sort = state.sort[0] === th.dataset.sort ? [th.dataset.sort, state.sort[1] === 'asc' ? 'desc' : 'asc'] : [th.dataset.sort, 'desc']; renderSymbols(); });
$('#ledgerRows').addEventListener('click', (event) => { const button = event.target.closest('[data-message]'); if (button) toast(button.dataset.message); });
$('#equityChart').addEventListener('mousemove', handleChartMove);
$('#equityChart').addEventListener('mouseleave', () => { $('#chartCursor')?.setAttribute('visibility', 'hidden'); $('#chartCursorPoint')?.setAttribute('visibility', 'hidden'); $('#chartTooltip').hidden = true; });
document.querySelectorAll('.rail nav a').forEach((link) => link.addEventListener('click', () => { document.querySelectorAll('.rail nav a').forEach((item) => item.classList.remove('active')); link.classList.add('active'); }));
loadDashboard();
