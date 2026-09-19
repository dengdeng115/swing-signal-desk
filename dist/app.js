const state = { review: null, filter: 'all', visible: 50, sort: ['closedLegs', 'desc'] };
const PUBLIC_SNAPSHOT = {
  mode: 'public_aggregate_snapshot', periodStart: '2026-08-18T16:00:00.000Z', periodEnd: '2026-09-19T05:26:36.357Z',
  metrics: { rawMessages: 629, parsedEvents: 425, closedLegs: 229, wins: 211, losses: 12, flats: 6, winRatePct: 92.14, medianReturnPct: 2.8425, tradeLikeUnresolved: 67 },
  coverage: { rawMessages: 629, parsedEvents: 425, includedClosedLegs: 229, unresolvedTradeLike: 67, duplicatesExcluded: 40, needsReview: 7 },
  dailyActivity: [['08-19',34],['08-20',31],['08-21',35],['08-24',16],['08-25',20],['08-26',16],['08-27',23],['08-28',14],['08-29',7],['08-31',5],['09-01',21],['09-02',25],['09-03',57],['09-04',27],['09-08',62],['09-09',12],['09-10',39],['09-11',29],['09-14',46],['09-15',6],['09-16',18],['09-17',76],['09-18',10]].map(([date,messages]) => ({ date: `2026-${date}`, messages })),
  bySymbol: [], legs: []
};
const $ = (selector) => document.querySelector(selector);
const number = (value, digits = 0) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
const pct = (value, digits = 2) => value == null ? '—' : `${value >= 0 ? '+' : ''}${number(value, digits)}%`;
const money = (value) => value == null ? '—' : `$${number(value, 2)}`;
const dateTime = (value) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function toast(text) { const el = $('#toast'); el.textContent = text; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600); }

function renderSummary(review) {
  const m = review.metrics;
  $('#periodText').textContent = `${dateTime(review.periodStart)} — ${dateTime(review.periodEnd)} · 已包含最后一晚消息`;
  $('#winRate').textContent = `${number(m.winRatePct, 2)}%`;
  $('#winFormula').textContent = `${m.wins} 盈 / ${m.losses} 亏 / ${m.flats} 持平`;
  $('#rawMessages').textContent = number(m.rawMessages);
  $('#closedLegs').textContent = number(m.closedLegs);
  $('#medianReturn').textContent = pct(m.medianReturnPct);
  $('#unresolved').textContent = number(m.tradeLikeUnresolved);
}

function renderActivity(rows) {
  const max = Math.max(...rows.map((row) => row.messages), 1);
  $('#activityChart').innerHTML = rows.map((row) => `<div class="day" title="${escapeHtml(row.date)} · ${row.messages} 条"><i style="height:${Math.max(8, row.messages / max * 100)}%"></i><span>${escapeHtml(row.date.slice(5).replace('-', '/'))}</span><b>${row.messages}</b></div>`).join('');
}

function renderCoverage(review) {
  const c = review.coverage;
  const items = [
    ['原始消息', c.rawMessages, 100],
    ['解析出的操作事件', c.parsedEvents, c.parsedEvents / c.rawMessages * 100],
    ['纳入胜率的已完成交易腿', c.includedClosedLegs, c.includedClosedLegs / c.rawMessages * 100],
    ['待人工理解的交易类消息', c.unresolvedTradeLike, c.unresolvedTradeLike / c.rawMessages * 100]
  ];
  $('#coverageFunnel').innerHTML = items.map(([label, value, width], index) => `<div><span>${label}<b>${value}</b></span><em><i style="width:${Math.max(width, 4)}%"></i></em>${index === 2 ? '<small>胜率分母</small>' : ''}</div>`).join('') + `<p>另排除重复操作事件 ${c.duplicatesExcluded} 条；中文名称映射等待复核 ${c.needsReview} 条。</p>`;
}

function renderSymbols() {
  const [key, direction] = state.sort;
  const rows = [...state.review.bySymbol].sort((a, b) => direction === 'asc' ? String(a[key]).localeCompare(String(b[key]), 'zh-CN', { numeric: true }) : String(b[key]).localeCompare(String(a[key]), 'zh-CN', { numeric: true }));
  $('#symbolTable tbody').innerHTML = rows.length ? rows.map((row) => `<tr><td><b class="ticker">${escapeHtml(row.symbol)}</b></td><td>${row.closedLegs}</td><td class="positive">${row.wins}</td><td class="negative">${row.losses}</td><td><div class="rate"><i style="width:${row.winRatePct}%"></i><span>${number(row.winRatePct, 1)}%</span></div></td><td class="${row.averageReturnPct >= 0 ? 'positive' : 'negative'}">${pct(row.averageReturnPct)}</td></tr>`).join('') : '<tr><td colspan="6">逐标的统计只在连接本地数据库后显示。</td></tr>';
}

function actionLabel(action) { return action === 'sell' ? '卖出' : action === 'rebuy' ? '加回' : '买入'; }
function reviewLabel(row) {
  if (row.analysisIncluded) return '已纳入';
  if (row.reviewStatus === 'needs_review') return '待复核';
  if (row.reviewStatus === 'excluded_duplicate') return '重复排除';
  return '未配对';
}
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
  const symbols = state.review.bySymbol.slice(0, 6).map((row) => row.symbol).join(',');
  $('#quoteList').innerHTML = '<div class="empty">正在读取长桥行情…</div>';
  try {
    const response = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbols)}`);
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    $('#quoteList').innerHTML = data.quotes.map((quote) => { const [session, live] = sessionQuote(quote); return `<div><b>${escapeHtml(quote.symbol)}</b><strong>$${number(live.last, 2)}</strong><span class="${quote.changePct >= 0 ? 'positive' : 'negative'}">${pct(quote.changePct)}</span><small>${session}${live.timestamp ? ` · ${dateTime(live.timestamp)}` : ''}</small></div>`; }).join('');
    $('#quoteTime').textContent = `长桥读取于 ${dateTime(data.receivedAt)}；盘前/盘后与常规盘分开标记。`;
  } catch { $('#quoteList').innerHTML = '<div class="empty">长桥暂不可用；历史胜率不受影响。</div>'; }
}

async function loadDashboard() {
  try {
    const response = await fetch('/api/dashboard', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('backend unavailable');
    const data = await response.json();
    if (!data.strategyReview) throw new Error('history unavailable');
    state.review = data.strategyReview;
    $('#connectionTitle').textContent = '本地数据库已连接';
    $('#connectionDetail').textContent = `PostgreSQL · ${data.strategyReview.metrics.rawMessages} 条原始消息`;
    renderSummary(state.review); renderActivity(state.review.dailyActivity); renderCoverage(state.review); renderSymbols(); renderLedger();
    await loadQuotes();
  } catch {
    state.review = PUBLIC_SNAPSHOT;
    $('#connectionTitle').textContent = '公开汇总快照';
    $('#connectionDetail').textContent = '原文与逐笔价格保持私密';
    renderSummary(state.review); renderActivity(state.review.dailyActivity); renderCoverage(state.review); renderSymbols(); renderLedger();
    $('#quoteList').innerHTML = '<div class="empty">长桥实时行情仅在本地服务提供。</div>';
    toast('当前显示公开汇总快照；原文和逐笔价格未公开。');
  }
}

$('#refreshButton').addEventListener('click', () => { state.visible = 50; loadDashboard(); });
$('#quoteRefresh').addEventListener('click', loadQuotes);
$('#showMore').addEventListener('click', () => { state.visible += 50; renderLedger(); });
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-filter]').forEach((item) => item.classList.remove('active')); button.classList.add('active'); state.filter = button.dataset.filter; state.visible = 50; renderLedger(); }));
$('#symbolTable thead').addEventListener('click', (event) => { const th = event.target.closest('[data-sort]'); if (!th || !state.review) return; state.sort = state.sort[0] === th.dataset.sort ? [th.dataset.sort, state.sort[1] === 'asc' ? 'desc' : 'asc'] : [th.dataset.sort, 'desc']; renderSymbols(); });
$('#ledgerRows').addEventListener('click', (event) => { const button = event.target.closest('[data-message]'); if (button) toast(button.dataset.message); });
document.querySelectorAll('.rail nav a').forEach((link) => link.addEventListener('click', () => { document.querySelectorAll('.rail nav a').forEach((item) => item.classList.remove('active')); link.classList.add('active'); }));
loadDashboard();
