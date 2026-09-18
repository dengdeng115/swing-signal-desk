const baseCapital = 1_000_000;
let capital = baseCapital;
let streamOn = true;
let signalCursor = 3;

const positions = [
  { symbol: 'NVDA', shares: 900, avg: 207.87, price: 220.00 },
  { symbol: 'TSLA', shares: 420, avg: 416.95, price: 432.00 },
  { symbol: 'AMD', shares: 430, avg: 202.00, price: 199.00 }
];

const signals = [
  { id: 1, time: '10:32:18', text: 'NVDA 220 附近减仓止盈半仓，剩余仓位继续观察。', parse: '卖出 NVDA 当前持仓的 50% · 参考价 $220.00', confidence: 96, status: 'pending', type: 'sell', symbol: 'NVDA', fraction: .5, price: 220 },
  { id: 2, time: '09:48:03', text: 'TSLA 回踩 428 分批接第一笔，止损放 416 下方。', parse: '首笔仓位 4% · 限价 $428.00 · 止损 $415.90', confidence: 88, status: 'done', type: 'buy', symbol: 'TSLA', fraction: .04, price: 428 },
  { id: 3, time: '昨天 15:42', text: 'AMD 拉升到 198，先落袋三分之一。', parse: '卖出 AMD 当前持仓的 33% · 参考价 $198.00', confidence: 94, status: 'done', type: 'sell', symbol: 'AMD', fraction: .33, price: 198 },
  { id: 4, time: '10:36:41', text: 'PLTR 先看 174 一带，冲高别追，等回踩再说。', parse: '仅为观察观点 · 缺少明确买入动作与仓位', confidence: 58, status: 'pending', type: 'note', symbol: 'PLTR', fraction: 0, price: 174 },
  { id: 5, time: '10:41:06', text: 'NVDA 如果站稳 223，剩余仓位继续拿，跌回 218 再处理。', parse: '持有 NVDA · 条件止损候选 $218.00 · 不立即交易', confidence: 79, status: 'pending', type: 'hold', symbol: 'NVDA', fraction: 0, price: 218 },
  { id: 6, time: '10:45:22', text: 'AAPL 252.5 先开一笔，仓位不要大，止损 248。', parse: '买入 AAPL · 默认第一笔 4% · 限价 $252.50 · 止损 $248.00', confidence: 86, status: 'pending', type: 'buy', symbol: 'AAPL', fraction: .04, price: 252.5 }
];

const trades = [
  { time:'今天 09:48:12', side:'buy', symbol:'TSLA', qty:93, signal:428, fill:428.34, lag:'9s / +0.08%', pnl:'—', source:'#swing-alerts' },
  { time:'昨天 15:42:08', side:'sell', symbol:'AMD', qty:210, signal:198, fill:197.86, lag:'8s / −0.07%', pnl:'+$3,964', source:'#swing-alerts' },
  { time:'9/16 13:06:31', side:'sell', symbol:'NVDA', qty:600, signal:217, fill:216.72, lag:'11s / −0.13%', pnl:'+$9,522', source:'#swing-alerts' },
  { time:'9/15 10:18:44', side:'buy', symbol:'AMD', qty:640, signal:191.5, fill:191.73, lag:'13s / +0.12%', pnl:'—', source:'#swing-alerts' },
  { time:'9/12 14:27:19', side:'buy', symbol:'NVDA', qty:1500, signal:207.5, fill:207.87, lag:'19s / +0.18%', pnl:'—', source:'#swing-alerts' },
  { time:'9/11 11:05:55', side:'sell', symbol:'META', qty:380, signal:771, fill:770.41, lag:'15s / −0.08%', pnl:'+$12,304', source:'#swing-alerts' }
];

function money(value, decimals = 0) {
  return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', minimumFractionDigits:decimals, maximumFractionDigits:decimals }).format(value);
}
function currentValue() { return positions.reduce((sum,p)=>sum+p.shares*p.price,0); }
function pnl(p) { return (p.price-p.avg)*p.shares; }
function showToast(message) { const el=document.querySelector('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>el.classList.remove('show'),2800); }

function renderSignals() {
  const visible = signals.slice(0, signalCursor).slice().reverse();
  document.querySelector('#signalFeed').innerHTML = visible.map(s => `
    <article class="signal-card ${s.status==='done'?'done':''}" data-id="${s.id}">
      <div class="avatar">W</div>
      <div class="signal-main"><div class="signal-author"><b>WaveTrader</b><time>· ${s.time}</time></div><p class="signal-copy">${s.text}</p><div class="parse-box"><strong>AI 解析</strong><span>${s.parse}</span><div class="confidence"><span>置信度 ${s.confidence}%</span><div class="confidence-bar"><i style="width:${s.confidence}%"></i></div>${s.confidence<65?'<span class="negative">不可自动执行</span>':''}</div></div></div>
      <div class="signal-action"><span class="action-chip ${s.status}">${s.status==='done'?'已模拟':s.status==='ignored'?'已忽略':'待确认'}</span>${s.status==='pending'?`<button class="confirm" data-action="confirm">确认</button><button class="ignore" data-action="ignore">忽略</button>`:''}</div>
    </article>`).join('');
}

function renderPositions() {
  const equity = capital + 38420;
  document.querySelector('#positionRows').innerHTML = positions.map(p => {
    const value=p.shares*p.price, gain=pnl(p), weight=value/equity*100;
    return `<tr><td><b>${p.symbol}</b><span class="side-label">NASDAQ</span></td><td>${p.shares.toLocaleString()} 股<span class="side-label">均价 ${money(p.avg,2)}</span></td><td><b>${money(p.price,2)}</b></td><td>${money(value)}</td><td>${weight.toFixed(1)}%</td><td class="${gain>=0?'positive':'negative'}">${gain>=0?'+':''}${money(gain)}</td></tr>`;
  }).join('');
  document.querySelector('#exposureBars').innerHTML = positions.map(p=>{const weight=p.shares*p.price/equity*100;return `<div class="exposure-item"><div class="bar-label"><span>${p.symbol}</span><b>${weight.toFixed(1)}%</b></div><div class="bar-track"><i style="width:${Math.min(weight/20*100,100)}%;${weight>20?'background:var(--red)':''}"></i></div></div>`}).join('');
  updateCapitalCards();
}

function renderTrades(filter='all') {
  const rows=trades.filter(t=>filter==='all'||t.side===filter);
  document.querySelector('#tradeRows').innerHTML=rows.map(t=>`<tr><td>${t.time}</td><td><span class="${t.side==='buy'?'side-buy':'side-sell'}">${t.side==='buy'?'买入':'卖出'}</span></td><td><b>${t.symbol}</b></td><td>${t.qty.toLocaleString()}</td><td>${money(t.signal,2)}</td><td>${money(t.fill,2)}</td><td>${t.lag}</td><td class="${t.pnl.startsWith('+')?'positive':''}">${t.pnl}</td><td>${t.source}</td></tr>`).join('');
}

function updateCapitalCards() {
  const equity=capital+38420, invested=currentValue(), util=invested/equity*100, cash=equity-invested, cap=Math.max(0,equity*.70-invested);
  document.querySelector('#equityValue').textContent=money(equity);
  document.querySelector('#returnValue').textContent=`+${money(38420)}`;
  document.querySelector('#returnRate').textContent=`+${(38420/capital*100).toFixed(2)}% 起始至今`;
  document.querySelector('#utilValue').textContent=`${util.toFixed(1)}%`;
  document.querySelector('#utilBar').style.width=`${Math.min(util/70*100,100)}%`;
  document.querySelector('#ringValue').textContent=`${Math.round(util)}%`;
  document.querySelector('.allocation-ring').style.background=`conic-gradient(var(--mint) 0 ${util}%,#18303b ${util}%)`;
  document.querySelector('#stockAlloc').textContent=money(invested);
  document.querySelector('#cashValue').textContent=money(cash);
  document.querySelector('#capacityValue').textContent=money(cap);
}

function handleSignal(id, action) {
  const s=signals.find(x=>x.id===id); if(!s) return;
  if(action==='ignore'){s.status='ignored';renderSignals();showToast('已保留原文并标记为忽略，不计入收益。');return;}
  if(s.type==='note'||s.confidence<65){showToast('这条消息不够明确，不能生成交易。');return;}
  s.status='done';
  if(s.type==='sell'){
    const p=positions.find(x=>x.symbol===s.symbol); if(p){const qty=Math.max(1,Math.floor(p.shares*s.fraction));p.shares-=qty;trades.unshift({time:'刚刚',side:'sell',symbol:s.symbol,qty,signal:s.price,fill:s.price-.09,lag:'7s / −0.04%',pnl:`+${money((s.price-p.avg)*qty)}`,source:'#swing-alerts'});}
  } else if(s.type==='buy'){
    const budget=capital*s.fraction,qty=Math.floor(budget/s.price),fill=s.price+.11;let p=positions.find(x=>x.symbol===s.symbol);if(p){p.avg=(p.avg*p.shares+fill*qty)/(p.shares+qty);p.shares+=qty;p.price=fill;}else{positions.push({symbol:s.symbol,shares:qty,avg:fill,price:fill});}trades.unshift({time:'刚刚',side:'buy',symbol:s.symbol,qty,signal:s.price,fill,lag:'8s / +0.04%',pnl:'—',source:'#swing-alerts'});
  }
  renderSignals();renderPositions();renderTrades();showToast(`已按规则写入 ${s.symbol} 模拟交易，并保留信号价与成交差异。`);
}

document.querySelector('#signalFeed').addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(!button)return;handleSignal(Number(button.closest('.signal-card').dataset.id),button.dataset.action)});
document.querySelector('#nextSignal').addEventListener('click',()=>{if(signalCursor<signals.length){signalCursor++;renderSignals();showToast('收到 1 条新模拟消息，已完成结构化解析。')}else showToast('演示消息已经全部送达。')});
document.querySelector('#streamToggle').addEventListener('click',e=>{streamOn=!streamOn;e.target.textContent=streamOn?'暂停模拟推送':'继续模拟推送';showToast(streamOn?'模拟消息流已继续。':'模拟消息流已暂停。')});
document.querySelector('#capitalSelect').addEventListener('change',e=>{capital=Number(e.target.value);renderPositions();showToast(`初始资金已切换为 ${money(capital)}，仓位比例已重算。`)});
document.querySelector('#markPrices').addEventListener('click',()=>{positions.forEach((p,i)=>p.price=+(p.price*(1+[.003,-.002,.004,.001][i%4])).toFixed(2));renderPositions();showToast('已用下一帧演示行情重估持仓。')});
document.querySelectorAll('[data-target]').forEach(btn=>btn.addEventListener('click',()=>{const target=document.querySelector(`#${btn.dataset.target}`);if(target)target.scrollIntoView({behavior:'smooth'});document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n===btn))}));
document.querySelectorAll('.filter-tabs button').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.filter-tabs button').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderTrades(btn.dataset.filter)}));
document.querySelector('#resetDemo').addEventListener('click',()=>location.reload());

renderSignals();renderPositions();renderTrades();
