/* ============================================================
   PSOS v3 — logic layer
   ============================================================ */

/* ---------------- migration (older saved states) ---------------- */
function migrate(){
  var st = S.settings;
  if (!st.cats) st.cats = {};
  if (!st.cats.income  || !st.cats.income.length)  st.cats.income  = DEFAULT_INCOME_CATS.slice();
  if (!st.cats.expense || !st.cats.expense.length) st.cats.expense = DEFAULT_EXPENSE_CATS.slice();
  if (!st.cats.nature  || !st.cats.nature.length)  st.cats.nature  = DEFAULT_NATURES.slice();
  if (!S.debts) S.debts = [];
  S.debts.forEach(function(d){ if (d.rate === undefined) d.rate = DEBT_RATE; });
  S.sources.forEach(function(x){ if (x.date === undefined) x.date = ''; });
  S.flows.forEach(function(x){
    if (x.due === undefined) x.due = '';
    if (x.status === undefined) x.status = 'pending';
  });
}
function incomeCats(){ return S.settings.cats.income; }
function expenseCats(){ return S.settings.cats.expense; }
function natures(){ return S.settings.cats.nature; }

/* ---------------- formatting ---------------- */
function n0(x){ return Math.round(x||0).toLocaleString('en-US'); }
function ugx(x){ return 'UGX ' + n0(x); }
function shortU(x){
  x = Math.round(x||0);
  var a = Math.abs(x), sg = x<0 ? '−' : '';
  if (a >= 1000000) return sg + (a/1000000).toFixed(a>=10000000?0:1).replace(/\.0$/,'') + 'm';
  if (a >= 1000) return sg + Math.round(a/1000) + 'k';
  return sg + a;
}
function esc(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function titleCase(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : ''; }

/* ---------------- core maths ---------------- */
function months(){ return (+S.settings.months) || 1; }
function rate(){ return (+S.settings.rate) || 1; }

function perMonth(amount, currency, freq){
  var b = (currency === 'USD') ? (+amount||0) * rate() : (+amount||0);
  switch(freq){
    case 'monthly':   return b;
    case 'quarterly': return b/3;
    case 'annual':    return b/12;
    case 'period':    return b/months();
    case 'oneoff':    return b/months();
    default:          return b;
  }
}
function srcM(s){ return perMonth(s.amount, s.currency, s.cadence); }
function flowM(f){ return perMonth(f.amount, f.currency, f.freq); }

/* Money a project brings in: income it generates + income allocated to it */
function projOwn(p){
  return S.sources.filter(function(s){ return s.projectId === p.id; })
    .reduce(function(t,s){ return t + srcM(s); }, 0);
}
function projAlloc(p){
  return (p.funding||[]).reduce(function(t,x){ return t + (+x.monthly||0); }, 0);
}
function projOut(p){
  return S.flows.filter(function(f){ return f.projectId === p.id; })
    .reduce(function(t,f){ return t + flowM(f); }, 0);
}
function projStats(p){
  var own = projOwn(p), alloc = projAlloc(p), out = projOut(p);
  return { own:own, alloc:alloc, inM:own+alloc, out:out, net:own+alloc-out };
}

/* How much of a source has been pledged away to projects */
function srcAllocated(s){
  var t = 0;
  S.projects.forEach(function(p){
    (p.funding||[]).forEach(function(x){ if (x.sourceId === s.id) t += (+x.monthly||0); });
  });
  return t;
}

function totals(){
  var inc = 0, certain = 0, overdue = 0, expected = 0, usdIn = 0, incByCat = {}, active = 0, recurIn = 0;
  S.sources.forEach(function(s){
    var m = srcM(s);
    inc += m;
    if (m > 0) active++;
    if (s.currency === 'USD') usdIn += m;
    if (s.cadence !== 'oneoff' && s.cadence !== 'period') recurIn += m;
    if (s.reliability === 'certain') certain += m;
    if (s.status === 'overdue') overdue += m;
    if (s.status === 'expected') expected += m;
    var k = s.category || 'Uncategorised';
    incByCat[k] = (incByCat[k]||0) + m;
  });
  var out = 0, byNature = {}, byCat = {}, untagged = 0, unassigned = 0, usdOut = 0, recurOut = 0;
  S.flows.forEach(function(f){
    var m = flowM(f);
    out += m;
    if (f.freq !== 'oneoff' && f.freq !== 'period') recurOut += m;
    if (f.currency === 'USD') usdOut += m;
    var nk = f.nature || 'Untagged';
    byNature[nk] = (byNature[nk]||0) + m;
    var ck = f.category || 'Untagged';
    byCat[ck] = (byCat[ck]||0) + m;
    if (!f.category || !f.nature) untagged += m;
    if (!f.projectId) unassigned += m;
  });
  var pledged = 0;
  S.projects.forEach(function(p){ pledged += projAlloc(p); });
  return { inc:inc, certain:certain, overdue:overdue, expected:expected, out:out, net:inc-out,
           pledged:pledged, unpledged:inc-pledged, byNature:byNature, byCat:byCat,
           incByCat:incByCat, untagged:untagged, unassigned:unassigned,
           usdOut:usdOut, usdIn:usdIn, active:active,
           recurIn:recurIn, recurOut:recurOut, recurNet:recurIn-recurOut };
}

function reserveTarget(r){
  if (r.auto) return totals().out * 3;
  return +r.target || 0;
}
function reserveMonthly(r){
  var gap = Math.max(reserveTarget(r) - (+r.balance||0), 0);
  if (!r.targetDate || !gap) return 0;
  var d = new Date(r.targetDate + 'T00:00:00');
  if (isNaN(d)) return 0;
  var m = Math.max((d - new Date()) / (1000*60*60*24*30.44), 1);
  return gap / m;
}

function dueInfo(f){
  if (!f.due) return null;
  var d = new Date(f.due + 'T00:00:00');
  if (isNaN(d)) return null;
  var days = Math.round((d - new Date().setHours(0,0,0,0)) / 86400000);
  if (f.status === 'paid') return { txt:'Paid', cls:'p-good', days:days };
  if (days < 0)  return { txt:'Overdue ' + Math.abs(days) + 'd', cls:'p-bad', days:days };
  if (days === 0) return { txt:'Due today', cls:'p-bad', days:days };
  if (days <= 7)  return { txt:'Due in ' + days + 'd', cls:'p-gold', days:days };
  return { txt:'Due ' + d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}), cls:'p-mute', days:days };
}

/* ---------------- debt ---------------- */
function debtStats(d){
  var bal = +d.balance || 0, ins = +d.instalment || 0, r = (d.rate === undefined ? DEBT_RATE : +d.rate);
  var delay = bal * r;                       // cost of slipping one month
  var months = (ins > 0 && bal > 0) ? Math.ceil(bal / ins) : 0;
  return { bal:bal, ins:ins, rate:r, delay:delay, months:months,
           unknown: bal <= 0, stuck: bal > 0 && ins <= 0 };
}
function debtFlow(d){
  var alias = { 'Car balance':'Car Deposit' };
  var nm = alias[d.name] || d.name;
  return S.flows.find(function(f){ return f.name === nm; }) || null;
}
function flowDebt(f){
  var alias = { 'Car Deposit':'Car balance' };
  var nm = alias[f.name] || f.name;
  return (S.debts||[]).find(function(d){ return d.name === nm; }) || null;
}
function debtTotals(){
  var bal = 0, ins = 0, delay = 0, unknown = 0, longest = 0, stuck = 0;
  S.debts.forEach(function(d){
    var x = debtStats(d);
    bal += x.bal; ins += x.ins; delay += x.delay;
    if (x.unknown) unknown++;
    if (x.stuck) stuck++;
    if (x.months > longest) longest = x.months;
  });
  return { bal:bal, ins:ins, delay:delay, unknown:unknown, longest:longest, stuck:stuck,
           count:S.debts.length };
}
function freeByDate(m){
  if (!m) return '';
  var d = new Date(); d.setMonth(d.getMonth() + m);
  return d.toLocaleDateString('en-GB', { month:'long', year:'numeric' });
}

/* ---------------- navigation ---------------- */
var TITLES = {
  position: ['PSOS · Position', 'The Ledger'],
  projects: ['PSOS · Projects', 'Money Trace'],
  money:    ['PSOS · Money', 'Sources & Flows'],
  reserves: ['PSOS · Reserves', 'What You Are Building'],
  advisor:  ['PSOS · Counsel', 'Read the Numbers']
};
var current = 'position';

function go(tab){
  current = tab;
  ['position','projects','money','reserves','advisor'].forEach(function(t){
    var sc = document.getElementById('sc-'+t), tb = document.getElementById('tab-'+t);
    if (sc) sc.classList.toggle('on', t===tab);
    if (tb) tb.classList.toggle('on', t===tab);
  });
  document.getElementById('mast-eyebrow').textContent = TITLES[tab][0];
  document.getElementById('mast-title').textContent = TITLES[tab][1];
  window.scrollTo({top:0, behavior:'smooth'});
  migrate();
persist();
renderAll();
handleShare();
}

function moneyTab(v){
  ['sources','flows','debts','ledger'].forEach(function(t){
    document.getElementById('mtab-'+t).classList.toggle('on', t===v);
    document.getElementById('mv-'+t).style.display = (t===v) ? '' : 'none';
  });
}

function toast(msg){
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(function(){ t.classList.remove('on'); }, 2100);
}

function openRef(kind, id){
  closeSheet();
  setTimeout(function(){
    if (kind === 'project'){ go('projects'); setTimeout(function(){ trace(id); }, 200); }
    else if (kind === 'source'){ go('money'); moneyTab('sources'); setTimeout(function(){ traceSource(id); }, 200); }
    else if (kind === 'flow'){ go('money'); moneyTab('flows'); setTimeout(function(){ editFlow(id); }, 200); }
    else if (kind === 'debt'){ go('money'); moneyTab('debts'); setTimeout(function(){ editDebt(id); }, 200); }
    else if (kind === 'reserve'){ go('reserves'); setTimeout(function(){ editReserve(id); }, 200); }
    else if (kind === 'category'){ go('position'); setTimeout(function(){ categoryDrill(id); }, 200); }
    else if (kind === 'money'){ go('money'); moneyTab(id); }
    else if (kind === 'tab'){ go(id); }
  }, 120);
}

function openSheet(html){
  document.getElementById('sheet-inner').innerHTML = '<div class="grab"></div>' + html;
  document.getElementById('sheet').classList.add('on');
  document.body.style.overflow = 'hidden';
}
function closeSheet(){
  document.getElementById('sheet').classList.remove('on');
  document.body.style.overflow = '';
}

/* ============================================================
   THE MONEY TRACE — the signature view
   ============================================================ */
function trace(pid){
  var p = S.projects.find(function(x){ return x.id === pid; });
  if (!p) return;
  var st = projStats(p);

  var own = S.sources.filter(function(s){ return s.projectId === p.id && srcM(s) > 0; });
  var allocs = (p.funding||[]).filter(function(f){ return (+f.monthly||0) > 0; });
  var outs = S.flows.filter(function(f){ return f.projectId === p.id; })
                    .sort(function(a,b){ return flowM(b) - flowM(a); });

  var h = '<h2>' + esc(p.name) + '</h2>'
        + '<div class="sh-sub">' + esc(p.docket||'Unfiled') + ' · strategic weight '
        + (p.weight||1) + ' of 5 · all figures per month</div>';

  h += '<div class="trace">';

  /* ---- inflow nodes ---- */
  h += '<div class="tr-node in"><div class="tr-lab">Where the money comes from</div>';
  if (!own.length && !allocs.length) {
    h += '<div class="tr-item"><span class="tr-name" style="color:var(--slate-dim)">Nothing funds this yet</span>'
       + '<span class="tr-amt" style="color:var(--slate-dim)">—</span></div>';
  }
  own.forEach(function(s){
    h += '<div class="tr-item tap" onclick="openRef(\'source\',\'' + s.id + '\')">'
       + '<span class="tr-name">' + esc(s.name) + ' <span class="mini">· earns ›</span></span>'
       + '<span class="tr-amt pos">' + ugx(srcM(s)) + '</span></div>';
  });
  allocs.forEach(function(a){
    var s = S.sources.find(function(x){ return x.id === a.sourceId; });
    h += '<div class="tr-item' + (s?' tap':'') + '"'
       + (s ? ' onclick="openRef(\'source\',\'' + s.id + '\')"' : '') + '>'
       + '<span class="tr-name">' + esc(s ? s.name : 'Unknown source')
       + ' <span class="mini">· allocated ›</span></span>'
       + '<span class="tr-amt pos">' + ugx(a.monthly) + '</span></div>';
  });
  h += '</div>';

  /* ---- hub ---- */
  h += '<div class="tr-node hub"><div class="tr-lab">The project</div>'
     + '<div class="tr-item"><span class="tr-hub">' + esc(p.name) + '</span>'
     + '<span class="tr-amt au">' + ugx(st.inM) + ' in</span></div></div>';

  /* ---- outflow nodes ---- */
  h += '<div class="tr-node out"><div class="tr-lab">Where the money goes</div>';
  if (!outs.length) {
    h += '<div class="tr-item"><span class="tr-name" style="color:var(--slate-dim)">No outflow tagged to this project</span>'
       + '<span class="tr-amt" style="color:var(--slate-dim)">—</span></div>';
  }
  outs.forEach(function(f){
    h += '<div class="tr-item tap" onclick="openRef(\'flow\',\'' + f.id + '\')">'
       + '<span class="tr-name">' + esc(f.name)
       + (f.nature ? ' <span class="mini">· ' + esc(f.nature) + '</span>' : '')
       + ' <span class="mini">›</span></span>'
       + '<span class="tr-amt neg">' + ugx(flowM(f)) + '</span></div>';
  });
  h += '</div></div>';

  /* ---- verdict ---- */
  var v, cls;
  if (st.inM === 0 && st.out === 0) {
    cls = 'v-gold';
    v = 'This project has <b>no financial footprint</b>. It costs nothing and earns nothing — '
      + 'which means it is running on your time alone. Decide whether that is deliberate.';
  } else if (st.inM === 0) {
    cls = 'v-bad';
    v = 'This project is <b>unfunded</b>. It draws ' + ugx(st.out) + ' every month and nothing '
      + 'has been assigned to pay for it, so it is being carried by your general surplus. '
      + 'Either allocate a source to it or accept that it is eating your margin.';
  } else if (st.net < -0.5) {
    cls = 'v-bad';
    v = 'Funded, but <b>short by ' + ugx(Math.abs(st.net)) + '</b> a month. '
      + 'The gap comes out of your unpledged income by default.';
  } else if (st.out === 0) {
    cls = 'v-good';
    v = 'This is a <b>net contributor</b>. It brings in ' + ugx(st.inM)
      + ' a month and costs nothing tagged against it. This is what pays for everything else.';
  } else if (st.net > 0.5) {
    cls = 'v-good';
    v = '<b>Self-funding with ' + ugx(st.net) + ' spare</b> each month after its own costs. '
      + 'That surplus is available to redirect.';
  } else {
    cls = 'v-good';
    v = '<b>Exactly funded.</b> Inflow and outflow match at ' + ugx(st.inM)
      + ' a month. No subsidy, no surplus.';
  }
  h += '<div class="verdict ' + cls + '">' + v + '</div>';

  if (p.note) h += '<div class="note" style="margin-top:12px">' + esc(p.note) + '</div>';

  h += '<div class="btn-row" style="margin-top:18px">'
     + '<button class="btn au" onclick="fundProject(\'' + p.id + '\')">Assign funding</button>'
     + '<button class="btn" onclick="assignFlows(\'' + p.id + '\')">Tag outflows</button>'
     + '<button class="btn ghost" onclick="editProject(\'' + p.id + '\')">Edit</button>'
     + '</div>'
     + '<button class="btn ghost wide" style="margin-top:9px" onclick="closeSheet()">Close</button>';

  openSheet(h);
}

/* ---- assign funding sources to a project ---- */
function fundProject(pid){
  var p = S.projects.find(function(x){ return x.id === pid; });
  var h = '<h2>Assign funding</h2><div class="sh-sub">' + esc(p.name)
        + ' · how much of each source is pledged here, per month</div>';
  S.sources.forEach(function(s){
    var cur = (p.funding||[]).find(function(f){ return f.sourceId === s.id; });
    var avail = srcM(s) - srcAllocated(s) + (cur ? (+cur.monthly||0) : 0);
    h += '<div class="f"><label>' + esc(s.name) + '</label>'
       + '<input type="number" inputmode="numeric" id="fund-' + s.id + '" value="'
       + (cur ? (+cur.monthly||0) : '') + '" placeholder="0">'
       + '<div class="hint">Source yields ' + ugx(srcM(s)) + ' a month · '
       + ugx(Math.max(avail,0)) + ' still unpledged</div></div>';
  });
  h += '<button class="btn au wide" onclick="saveFunding(\'' + pid + '\')">Save funding</button>'
     + '<button class="btn ghost wide" style="margin-top:9px" onclick="trace(\'' + pid + '\')">Back</button>';
  openSheet(h);
}
function saveFunding(pid){
  var p = S.projects.find(function(x){ return x.id === pid; });
  var f = [];
  S.sources.forEach(function(s){
    var el = document.getElementById('fund-' + s.id);
    var v = el ? parseFloat(el.value) : 0;
    if (v > 0) f.push({ sourceId: s.id, monthly: v });
  });
  p.funding = f;
  persist(); migrate();
persist();
renderAll();
handleShare(); trace(pid); toast('Funding saved');
}

/* ---- tag outflows to a project ---- */
function assignFlows(pid){
  var p = S.projects.find(function(x){ return x.id === pid; });
  var h = '<h2>Tag outflows</h2><div class="sh-sub">' + esc(p.name)
        + ' · tick every cost this project drives</div>';
  S.flows.forEach(function(f){
    var owner = f.projectId ? S.projects.find(function(x){ return x.id === f.projectId; }) : null;
    var taken = owner && owner.id !== pid;
    h += '<label class="row tap" style="cursor:pointer">'
       + '<span class="row-main"><span class="row-t">'
       + '<input type="checkbox" id="tag-' + f.id + '"' + (f.projectId===pid?' checked':'')
       + ' style="margin-right:9px;transform:scale(1.25)">' + esc(f.name) + '</span>'
       + '<span class="row-s">' + (taken ? 'currently on ' + esc(owner.name) : 'unassigned') + '</span></span>'
       + '<span class="row-v num neg">' + ugx(flowM(f)) + '</span></label>';
  });
  h += '<button class="btn au wide" style="margin-top:14px" onclick="saveTags(\'' + pid + '\')">Save tags</button>'
     + '<button class="btn ghost wide" style="margin-top:9px" onclick="trace(\'' + pid + '\')">Back</button>';
  openSheet(h);
}
function saveTags(pid){
  S.flows.forEach(function(f){
    var el = document.getElementById('tag-' + f.id);
    if (!el) return;
    if (el.checked) f.projectId = pid;
    else if (f.projectId === pid) f.projectId = '';
  });
  persist(); migrate();
persist();
renderAll();
handleShare(); trace(pid); toast('Outflows tagged');
}

/* ============================================================
   RENDER — position
   ============================================================ */
function renderStrip(){
  var t = totals();
  document.getElementById('s-in').textContent = shortU(t.inc);
  document.getElementById('s-out').textContent = shortU(t.out);
  document.getElementById('s-free').textContent = shortU(t.unpledged);
  var unf = S.projects.filter(function(p){ var st = projStats(p); return st.out > 0 && st.inM < st.out - 0.5; }).length;
  var el = document.getElementById('s-unf');
  el.textContent = unf;
  el.className = 'v num ' + (unf ? 'neg' : 'pos');
}

function renderPosition(){
  var t = totals();
  var bare = !S.sources.length && !S.flows.length && !S.projects.length;
  var fr = document.getElementById('firstrun');
  if (fr) fr.style.display = bare ? '' : 'none';
  var net = t.net;
  var h = document.getElementById('h-net');
  h.textContent = (net<0?'−':'') + 'UGX ' + n0(Math.abs(net));
  h.className = 'fig num ' + (net<0 ? 'neg' : 'pos');
  document.getElementById('h-net-sub').textContent =
    ugx(net*months()) + ' across the ' + months() + '-month period · $'
    + n0(net/rate()) + ' a month · '
    + (t.inc ? Math.round(net/t.inc*100) : 0) + '% of income retained';

  document.getElementById('r-inc').textContent = ugx(t.inc);
  document.getElementById('r-inc-s').textContent = t.active + ' active of ' + S.sources.length
    + ' · ' + ugx(t.certain) + ' certain'
    + (t.usdIn ? ' · ' + ugx(t.usdIn) + ' in USD' : '');
  document.getElementById('r-out').textContent = ugx(t.out);
  document.getElementById('r-out-s').textContent = S.flows.length + ' outflows · '
    + ugx(t.usdOut) + ' USD-denominated';
  document.getElementById('r-pledged').textContent = ugx(t.pledged);
  var up = document.getElementById('r-unpledged');
  up.textContent = ugx(t.unpledged);
  up.className = 'row-v num ' + (t.unpledged < 0 ? 'neg' : 'au');

  /* commitment load */
  var pct = t.inc ? (t.out / t.inc * 100) : 0;
  document.getElementById('load-t').textContent = Math.round(pct) + '% of income already committed';
  document.getElementById('load-s').textContent = ugx(t.out) + ' out of ' + ugx(t.inc) + ' a month';
  var bar = document.getElementById('load-bar');
  bar.style.width = Math.min(pct,100) + '%';
  bar.className = pct > 100 ? 'over' : (pct > 80 ? '' : 'ok');
  document.getElementById('load-note').textContent = pct > 100
    ? 'You are spending more than you earn. The difference comes from reserves or borrowing.'
    : (pct > 80 ? 'Above 80%. There is very little room for a surprise.'
                : 'Under 80%. There is genuine headroom here.');

  var dt = debtTotals();
  document.getElementById('debt-card').innerHTML = dt.count === 0
    ? '<div class="empty"><b>No debts recorded</b>Add them under Money to price delay.</div>'
    : '<div class="row"><div class="row-main"><div class="row-t">Outstanding</div>'
      + '<div class="row-s">' + (dt.unknown ? dt.unknown + ' of ' + dt.count + ' balances still to enter'
                                            : dt.count + ' obligations') + '</div></div>'
      + '<div class="row-v num neg">' + (dt.bal ? ugx(dt.bal) : '—') + '</div></div>'
      + '<div class="row"><div class="row-main"><div class="row-t">One month of delay costs</div>'
      + '<div class="row-s">Penalty at the rates you have set</div></div>'
      + '<div class="row-v num neg">' + ugx(dt.delay) + '</div></div>'
      + '<div class="row"><div class="row-main"><div class="row-t">Free and clear</div>'
      + '<div class="row-s">' + (dt.longest ? freeByDate(dt.longest) : 'Enter balances to project') + '</div></div>'
      + '<div class="row-v num au">' + (dt.longest ? dt.longest + ' mo' : '—') + '</div></div>';

  var rn = t.recurNet;
  document.getElementById('run-in').textContent = ugx(t.recurIn);
  document.getElementById('run-out').textContent = ugx(t.recurOut);
  var rnEl = document.getElementById('run-net');
  rnEl.textContent = (rn<0?'\u2212':'') + 'UGX ' + n0(Math.abs(rn));
  rnEl.className = 'row-v num ' + (rn<0 ? 'neg' : 'pos');
  document.getElementById('run-note').textContent = rn < 0
    ? 'Strip out the one-offs and you are short ' + ugx(Math.abs(rn))
      + ' every month. This month only works because of money that will not come again.'
    : 'Your recurring income covers your recurring commitments. The one-offs are genuine surplus.';

  renderComposition();
  document.getElementById('donut-card').innerHTML = donut(t.incByCat, t.inc, 'PER MONTH');
  renderTopFive();

  /* alerts */
  document.getElementById('alerts-card').innerHTML = buildAlerts().map(function(a){
    var go = a.r ? ' tap" onclick="openRef(\'' + a.r[0] + '\',\'' + a.r[1] + '\')"' : '"';
    return '<div class="alert' + go + '><span class="dot" style="background:' + a.c + '"></span>'
      + '<span class="tx"><b>' + a.t + '</b><span>' + a.s + '</span></span>'
      + (a.r ? '<span class="chev">›</span>' : '') + '</div>';
  }).join('') || '<div class="empty"><b>All clear</b>Nothing in the ledger needs your attention.</div>';

  document.getElementById('set-rate').value = S.settings.rate;
  document.getElementById('set-months').value = S.settings.months;
}

function buildAlerts(){
  var t = totals(), a = [];
  var RED = 'var(--bad)', AU = 'var(--gold-hi)', GR = 'var(--good)';

  var dt = debtTotals();
  if (dt.unknown) a.push({r:['money','debts'], c:AU, t:dt.unknown + ' debt balance' + (dt.unknown>1?'s':'') + ' not entered',
    s:'Until each balance is known the app cannot tell you what delay costs or when you are free.'});
  if (dt.delay > 0) a.push({r:['money','debts'], c:RED, t:'Delay costs ' + ugx(dt.delay) + ' a month',
    s:'That is the penalty for slipping one month on the balances you have entered.'});
  if (dt.stuck) a.push({r:['money','debts'], c:RED, t:dt.stuck + ' debt' + (dt.stuck>1?'s':'') + ' with no instalment',
    s:'A balance with nothing scheduled against it never clears.'});
  if (t.recurNet < 0 && t.net >= 0) a.push({r:['tab','position'], c:RED, t:'Positive month, negative run rate',
    s:'Once the one-off receipts clear, recurring income falls ' + ugx(Math.abs(t.recurNet))
      + ' a month short of recurring commitments.'});
  if (t.net < 0) a.push({r:['money','flows'], c:RED, t:'You are in deficit',
    s:'Outflows exceed income by ' + ugx(Math.abs(t.net)) + ' a month.'});
  if (t.unpledged < 0) a.push({r:['money','sources'], c:RED, t:'Income over-pledged',
    s:'You have promised ' + ugx(Math.abs(t.unpledged)) + ' a month more than you actually earn.'});

  S.sources.forEach(function(s){
    var al = srcAllocated(s), av = srcM(s);
    if (al > av + 0.5) a.push({r:['source',s.id], c:RED, t:'Over-allocated: ' + esc(s.name),
      s:'Pledged ' + ugx(al) + ' from a source that yields ' + ugx(av) + '.'});
  });

  var unf = S.projects.filter(function(p){ var st = projStats(p); return st.out>0 && st.inM < st.out-0.5; });
  if (unf.length) a.push({r:['project',unf[0].id], c:RED, t:unf.length + ' project' + (unf.length>1?'s':'') + ' unfunded',
    s:unf.map(function(p){ return p.name; }).join(', ') + ' — costs with no source behind them.'});

  if (t.unassigned > 0) a.push({r:['money','flows'], c:AU, t:ugx(t.unassigned) + ' a month unassigned',
    s:'These outflows belong to no project, so you cannot see what they are buying you.'});
  if (t.untagged > 0) a.push({r:['money','flows'], c:AU, t:ugx(t.untagged) + ' a month untagged',
    s:'Outflows missing a category or nature. Composition below is incomplete until fixed.'});
  if (t.overdue > 0) a.push({r:['money','sources'], c:RED, t:ugx(t.overdue) + ' of income overdue',
    s:'Money you have budgeted against but have not been paid. Chase it first.'});

  var disc = t.byNature['Discretionary'] || 0;
  if (t.inc && disc/t.inc > 0.20) a.push({r:['category','Personal & Upkeep'], c:AU, t:'Discretionary spend above 20%',
    s:ugx(disc) + ' a month, or ' + Math.round(disc/t.inc*100) + '% of income.'});

  if (t.usdOut > 0) {
    var hit = t.usdOut * 0.1;
    a.push({r:['money','flows'], c:AU, t:'FX exposure ' + ugx(t.usdOut) + ' a month',
      s:'A 10% shilling slide costs you ' + ugx(hit) + ' a month, straight off the surplus.'});
  }

  var resBal = S.reserves.reduce(function(x,r){ return x + (+r.balance||0); }, 0);
  var cover = t.out ? resBal/t.out : 0;
  if (cover < 3) a.push({r:['tab','reserves'], c: cover < 1 ? RED : AU, t:'Reserve cover ' + cover.toFixed(1) + ' months',
    s:'Three months is the floor. You hold ' + ugx(resBal) + ' against ' + ugx(t.out) + ' of monthly outflow.'});
  else a.push({r:['tab','reserves'], c:GR, t:'Reserve cover ' + cover.toFixed(1) + ' months', s:'At or above the three-month floor.'});

  var reqTotal = S.reserves.reduce(function(x,r){ return x + reserveMonthly(r); }, 0);
  if (reqTotal > t.net && reqTotal > 0) a.push({r:['tab','reserves'], c:AU, t:'Goals outrun your surplus',
    s:'Funding every goal on time needs ' + ugx(reqTotal) + ' a month against a surplus of ' + ugx(t.net) + '.'});

  return a;
}

var DONUT = ['#D4AF37','#2A5CA8','#3E8E6E','#AE8B2D','#6D9BE0','#8593A6','#1D3D63','#C9C4B4'];

function donut(map, total, centreLabel){
  var keys = Object.keys(map).filter(function(k){ return map[k] > 0; })
                   .sort(function(a,b){ return map[b]-map[a]; });
  if (!keys.length || !total) {
    return '<div class="empty"><b>Nothing to plot</b>Add amounts and they will appear here.</div>';
  }
  var R = 52, C = 2*Math.PI*R, off = 0, arcs = '';
  keys.forEach(function(k, i){
    var len = map[k]/total*C;
    arcs += '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + DONUT[i%DONUT.length]
         +  '" stroke-width="21" stroke-dasharray="' + len.toFixed(2) + ' ' + (C-len).toFixed(2)
         +  '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 70 70)"></circle>';
    off += len;
  });
  var svg = '<svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Composition">'
          + arcs
          + '<text x="70" y="66" text-anchor="middle" fill="#EFEDE6" font-size="15" font-weight="700"'
          + ' font-family="Archivo,sans-serif">' + shortU(total) + '</text>'
          + '<text x="70" y="82" text-anchor="middle" fill="#8593A6" font-size="8"'
          + ' letter-spacing="1.4" font-family="Archivo,sans-serif">' + centreLabel + '</text></svg>';
  var legend = keys.map(function(k, i){
    return '<div class="lg"><span class="sw" style="background:' + DONUT[i%DONUT.length] + '"></span>'
      + '<span class="lg-n">' + esc(k) + '</span>'
      + '<span class="lg-v num">' + Math.round(map[k]/total*100) + '%</span></div>';
  }).join('');
  return '<div class="donut-wrap">' + svg + '<div class="lg-list">' + legend + '</div></div>';
}

var compView = 'nature';
function compTab(v){
  compView = v;
  var b = document.querySelectorAll('#comp-seg button');
  b[0].classList.toggle('on', v === 'nature');
  b[1].classList.toggle('on', v === 'category');
  var dt = debtTotals();
  document.getElementById('debt-card').innerHTML = dt.count === 0
    ? '<div class="empty"><b>No debts recorded</b>Add them under Money to price delay.</div>'
    : '<div class="row"><div class="row-main"><div class="row-t">Outstanding</div>'
      + '<div class="row-s">' + (dt.unknown ? dt.unknown + ' of ' + dt.count + ' balances still to enter'
                                            : dt.count + ' obligations') + '</div></div>'
      + '<div class="row-v num neg">' + (dt.bal ? ugx(dt.bal) : '—') + '</div></div>'
      + '<div class="row"><div class="row-main"><div class="row-t">One month of delay costs</div>'
      + '<div class="row-s">Penalty at the rates you have set</div></div>'
      + '<div class="row-v num neg">' + ugx(dt.delay) + '</div></div>'
      + '<div class="row"><div class="row-main"><div class="row-t">Free and clear</div>'
      + '<div class="row-s">' + (dt.longest ? freeByDate(dt.longest) : 'Enter balances to project') + '</div></div>'
      + '<div class="row-v num au">' + (dt.longest ? dt.longest + ' mo' : '—') + '</div></div>';

  var rn = t.recurNet;
  document.getElementById('run-in').textContent = ugx(t.recurIn);
  document.getElementById('run-out').textContent = ugx(t.recurOut);
  var rnEl = document.getElementById('run-net');
  rnEl.textContent = (rn<0?'\u2212':'') + 'UGX ' + n0(Math.abs(rn));
  rnEl.className = 'row-v num ' + (rn<0 ? 'neg' : 'pos');
  document.getElementById('run-note').textContent = rn < 0
    ? 'Strip out the one-offs and you are short ' + ugx(Math.abs(rn))
      + ' every month. This month only works because of money that will not come again.'
    : 'Your recurring income covers your recurring commitments. The one-offs are genuine surplus.';

  renderComposition();
}
function renderComposition(){
  var t = totals();
  var map = (compView === 'nature') ? t.byNature : t.byCat;
  var c = document.getElementById('comp-card');
  var keys = Object.keys(map).sort(function(a,b){ return map[b]-map[a]; });
  if (!keys.length) {
    c.innerHTML = '<div class="empty"><b>Nothing recorded</b>Add outflows to see the shape of your spending.</div>';
    return;
  }
  c.innerHTML = keys.map(function(k){
    var v = map[k], p = t.out ? v/t.out*100 : 0;
    var flag = (k === 'Untagged' || k === 'Uncategorised');
    var link = (compView === 'category') ? ' tap" onclick="categoryDrill(\'' + k.replace(/'/g,"") + '\')"' : '"';
    return '<div class="row' + link + '><div class="row-main"><div class="row-t">' + esc(k) + '</div>'
      + '<div class="bar" style="margin-top:6px"><i' + (flag?' class="over"':'')
      + ' style="width:' + p.toFixed(1) + '%"></i></div></div>'
      + '<div class="row-v num">' + shortU(v) + '<small>' + p.toFixed(0) + '%</small></div></div>';
  }).join('');
}

function renderTopFive(){
  var t = totals();
  var top = S.flows.slice().sort(function(a,b){ return flowM(b)-flowM(a); }).slice(0,5);
  var el = document.getElementById('top5-card');
  if (!top.length) { el.innerHTML = '<div class="empty"><b>No outflows</b>Nothing to rank yet.</div>'; return; }
  el.innerHTML = top.map(function(f, i){
    var m = flowM(f), p = t.out ? m/t.out*100 : 0;
    var owner = S.projects.find(function(x){ return x.id === f.projectId; });
    return '<div class="row tap" onclick="openRef(\'flow\',\'' + f.id + '\')">'
      + '<div class="row-main"><div class="row-t"><span class="rank num">' + (i+1) + '</span>'
      + esc(f.name) + '</div>'
      + '<div class="bar" style="margin-top:6px"><i style="width:' + p.toFixed(1) + '%"></i></div>'
      + '<div class="mini" style="margin-top:5px">' + (owner ? esc(owner.name) : 'unassigned')
      + ' · ' + p.toFixed(0) + '% of outflow · ' + ugx(m*12) + ' a year</div></div>'
      + '<div class="row-v num neg">' + shortU(m) + '<small>/month</small></div></div>';
  }).join('');
}

function traceSource(sid){
  var s = S.sources.find(function(x){ return x.id === sid; });
  if (!s) return;
  var m = srcM(s), al = srcAllocated(s), free = m - al;
  var owner = S.projects.find(function(p){ return p.id === s.projectId; });

  var funds = [];
  S.projects.forEach(function(p){
    (p.funding||[]).forEach(function(f){
      if (f.sourceId === sid && (+f.monthly||0) > 0) funds.push({ p:p, amt:+f.monthly });
    });
  });
  funds.sort(function(a,b){ return b.amt - a.amt; });

  var h = '<h2>' + esc(s.name) + '</h2>'
        + '<div class="sh-sub">' + esc(s.payer || 'No payer named') + ' · ' + esc(s.category)
        + ' · ' + esc(titleCase(s.status)) + ' · ' + esc(titleCase(s.reliability)) + '</div>';

  h += '<div class="card"><div class="row"><div class="row-main"><div class="row-t">Yields</div>'
     + '<div class="row-s">' + esc(s.currency) + ' ' + n0(s.amount) + ' · ' + esc(s.cadence) + '</div></div>'
     + '<div class="row-v num pos">' + ugx(m) + '</div></div>'
     + '<div class="row"><div class="row-main"><div class="row-t">Pledged to projects</div>'
     + '<div class="row-s">' + funds.length + ' claim' + (funds.length===1?'':'s') + ' on it</div></div>'
     + '<div class="row-v num au">' + ugx(al) + '</div></div>'
     + '<div class="row"><div class="row-main"><div class="row-t">' + (free < 0 ? 'Over-pledged' : 'Still free') + '</div>'
     + '<div class="row-s">' + (free < 0 ? 'You have promised more than it yields' : 'Available to assign') + '</div></div>'
     + '<div class="row-v num ' + (free<0?'neg':'pos') + '">' + ugx(Math.abs(free)) + '</div></div>'
     + '<div class="bar"><i class="' + (free<0?'over':'ok') + '" style="width:'
     + (m ? Math.min(al/m*100,100).toFixed(0) : 0) + '%"></i></div></div>';

  if (owner) {
    h += '<div class="sec">Earned by</div><div class="card">'
       + '<div class="row tap" onclick="openRef(\'project\',\'' + owner.id + '\')">'
       + '<div class="row-main"><div class="row-t">' + esc(owner.name) + '</div>'
       + '<div class="row-s">Trace this project</div></div><div class="chev">›</div></div></div>';
  }

  h += '<div class="sec">Where it is committed</div><div class="card">';
  h += funds.length ? funds.map(function(f){
      return '<div class="row tap" onclick="openRef(\'project\',\'' + f.p.id + '\')">'
        + '<div class="row-main"><div class="row-t">' + esc(f.p.name) + '</div>'
        + '<div class="row-s">' + Math.round(f.amt/m*100) + '% of this source</div></div>'
        + '<div class="row-v num neg">' + ugx(f.amt) + '</div><div class="chev">›</div></div>';
    }).join('')
    : '<div class="empty"><b>Nothing claims it</b>Every shilling of this source is unassigned.</div>';
  h += '</div>';

  if (s.note) h += '<div class="note" style="margin-top:12px">' + esc(s.note) + '</div>';
  h += '<div class="btn-row" style="margin-top:16px">'
     + '<button class="btn au" onclick="editSource(\'' + sid + '\')">Edit source</button>'
     + '<button class="btn ghost" onclick="closeSheet()">Close</button></div>';
  openSheet(h);
}

function categoryDrill(cat){
  var t = totals();
  var items = S.flows.filter(function(f){ return (f.category||'Untagged') === cat; })
                     .sort(function(a,b){ return flowM(b)-flowM(a); });
  var sum = items.reduce(function(x,f){ return x + flowM(f); }, 0);
  var h = '<h2>' + esc(cat) + '</h2><div class="sh-sub">' + items.length + ' outflow'
        + (items.length===1?'':'s') + ' · ' + ugx(sum) + ' a month · '
        + (t.out ? Math.round(sum/t.out*100) : 0) + '% of everything leaving</div>'
        + '<div class="card">' + items.map(function(f){
            var owner = S.projects.find(function(p){ return p.id === f.projectId; });
            return '<div class="row tap" onclick="openRef(\'flow\',\'' + f.id + '\')">'
              + '<div class="row-main"><div class="row-t">' + esc(f.name) + '</div>'
              + '<div class="row-s">' + (owner ? esc(owner.name) : 'unassigned')
              + (f.nature ? ' · ' + esc(f.nature) : '') + '</div></div>'
              + '<div class="row-v num neg">' + ugx(flowM(f)) + '</div><div class="chev">›</div></div>';
          }).join('') + '</div>'
        + '<button class="btn ghost wide" style="margin-top:14px" onclick="closeSheet()">Close</button>';
  openSheet(h);
}

/* ============================================================
   RENDER — projects
   ============================================================ */
var projSort = 'weight';
function sortProjects(){
  projSort = (projSort === 'weight') ? 'drain' : 'weight';
  toast(projSort === 'drain' ? 'Sorted by net drain' : 'Sorted by strategic weight');
  renderProjects();
}

function renderProjects(){
  var list = S.projects.slice();
  if (projSort === 'drain') list.sort(function(a,b){ return projStats(a).net - projStats(b).net; });
  else list.sort(function(a,b){ return (b.weight||0) - (a.weight||0); });

  var el = document.getElementById('proj-list');
  if (!list.length) {
    el.innerHTML = '<div class="empty"><b>No projects yet</b>Add one, then trace what it costs and what it earns.</div>';
    return;
  }
  var groups = {};
  list.forEach(function(p){ var d = p.docket||'Unfiled'; (groups[d] = groups[d]||[]).push(p); });

  el.innerHTML = Object.keys(groups).map(function(d){
    return '<div class="sec">' + esc(d) + '</div><div class="card">'
      + groups[d].map(function(p){
        var st = projStats(p), pill, cls;
        if (st.inM === 0 && st.out === 0) { pill = 'No money'; cls = 'p-mute'; }
        else if (st.out === 0) { pill = 'Contributes ' + shortU(st.inM); cls = 'p-good'; }
        else if (st.inM === 0) { pill = 'Unfunded'; cls = 'p-bad'; }
        else if (st.net < -0.5) { pill = 'Short ' + shortU(Math.abs(st.net)); cls = 'p-bad'; }
        else if (st.net > 0.5) { pill = 'Spare ' + shortU(st.net); cls = 'p-good'; }
        else { pill = 'Funded'; cls = 'p-gold'; }
        return '<div class="row tap" onclick="trace(\'' + p.id + '\')">'
          + '<div class="row-main"><div class="row-t">' + esc(p.name) + '</div>'
          + '<div class="row-s"><span class="pill ' + cls + '">' + pill + '</span>'
          + '<span style="margin-left:8px">in ' + shortU(st.inM) + ' · out ' + shortU(st.out) + '</span></div></div>'
          + '<div class="chev">›</div></div>';
      }).join('') + '</div>';
  }).join('');
}

/* ============================================================
   RENDER — money
   ============================================================ */
function renderSources(){
  var el = document.getElementById('src-list');
  if (!S.sources.length) {
    el.innerHTML = '<div class="empty"><b>No income recorded</b>Add where your money actually comes from.</div>';
    return;
  }
  var t = totals();
  var summary = '<div class="card"><div class="card-h"><div class="card-t">Income summary</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Every month</div>'
    + '<div class="row-s">' + t.active + ' sources actually paying</div></div>'
    + '<div class="row-v num pos">' + ugx(t.inc) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Received</div>'
    + '<div class="row-s">Money already in hand</div></div>'
    + '<div class="row-v num pos">' + ugx(t.inc - t.expected - t.overdue) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Expected</div>'
    + '<div class="row-s">Budgeted against but not yet paid</div></div>'
    + '<div class="row-v num au">' + ugx(t.expected) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Overdue</div>'
    + '<div class="row-s">Chase these first</div></div>'
    + '<div class="row-v num ' + (t.overdue?'neg':'') + '">' + ugx(t.overdue) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">USD-denominated</div>'
    + '<div class="row-s">Moves with the rate of ' + n0(rate()) + '</div></div>'
    + '<div class="row-v num">' + ugx(t.usdIn) + '</div></div></div>';

  el.innerHTML = summary + '<div class="card">' + S.sources.map(function(s){
    var m = srcM(s), al = srcAllocated(s);
    var over = al > m + 0.5;
    var stPill = s.status === 'received' ? 'p-good' : (s.status === 'overdue' ? 'p-bad' : 'p-gold');
    var owner = S.projects.find(function(p){ return p.id === s.projectId; });
    return '<div class="row tap" onclick="traceSource(\'' + s.id + '\')">'
      + '<div class="row-main"><div class="row-t">' + esc(s.name) + '</div>'
      + '<div class="row-s"><span class="pill ' + stPill + '">' + titleCase(s.status) + '</span> '
      + esc(s.currency) + ' · ' + esc(titleCase(s.reliability))
      + (s.date ? ' · ' + new Date(s.date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : '')
      + (owner ? ' · ' + esc(owner.name) : '') + '</div>'
      + '<div class="bar"><i class="' + (over?'over':'ok') + '" style="width:'
      + (m ? Math.min(al/m*100,100).toFixed(0) : 0) + '%"></i></div>'
      + '<div class="mini" style="margin-top:5px">' + ugx(al) + ' of ' + ugx(m) + ' pledged'
      + (over ? ' — over-allocated' : '') + '</div></div>'
      + '<div class="row-v num pos">' + shortU(m) + '<small>/month</small></div></div>';
  }).join('') + '</div>';
}

function renderFlows(){
  var el = document.getElementById('flow-list');
  if (!S.flows.length) {
    el.innerHTML = '<div class="empty"><b>No outflows recorded</b>Add what leaves, and where it goes.</div>';
    return;
  }
  var t = totals();
  var soon = S.flows.filter(function(f){ var d = dueInfo(f); return d && f.status !== 'paid' && d.days <= 30; });
  var soonSum = soon.reduce(function(x,f){ return x + flowM(f); }, 0);
  var summary = '<div class="card"><div class="card-h"><div class="card-t">Outflow summary</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Every month</div>'
    + '<div class="row-s">' + S.flows.length + ' outflows</div></div>'
    + '<div class="row-v num neg">' + ugx(t.out) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Annualised</div>'
    + '<div class="row-s">Monthly equivalent × 12</div></div>'
    + '<div class="row-v num neg">' + ugx(t.out*12) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Falling due within 30 days</div>'
    + '<div class="row-s">' + (soon.length ? soon.length + ' with a date set' : 'No due dates set yet') + '</div></div>'
    + '<div class="row-v num au">' + ugx(soonSum) + '</div></div></div>';

  var sorted = S.flows.slice().sort(function(a,b){ return flowM(b) - flowM(a); });
  el.innerHTML = summary + '<div class="card">' + sorted.map(function(f){
    var owner = S.projects.find(function(p){ return p.id === f.projectId; });
    var d = dueInfo(f);
    return '<div class="row tap" onclick="editFlow(\'' + f.id + '\')">'
      + '<div class="row-main"><div class="row-t">' + esc(f.name) + '</div>'
      + '<div class="row-s">'
      + (owner ? esc(owner.name) : '<span class="pill p-bad">Unassigned</span>')
      + (f.nature ? ' · ' + esc(f.nature) : ' · <span class="pill p-mute">Untagged</span>')
      + (d ? ' · <span class="pill ' + d.cls + '">' + d.txt + '</span>' : '') + '</div></div>'
      + '<div class="row-v num neg">' + shortU(flowM(f)) + '<small>' + shortU(flowM(f)*12) + '/yr</small></div></div>';
  }).join('') + '</div>';
}

function renderLedger(){
  var t = totals();
  var now = new Date(), mk = now.getFullYear() + '-' + (now.getMonth()+1);
  var inA = 0, outA = 0;
  S.ledger.forEach(function(e){
    var d = new Date(e.ts);
    if (d.getFullYear() + '-' + (d.getMonth()+1) !== mk) return;
    var v = (e.currency === 'USD') ? e.amount * rate() : e.amount;
    if (e.type === 'credit') inA += v; else outA += v;
  });
  document.getElementById('ledger-summary').innerHTML =
      '<div class="card-h"><div class="card-t">This month, actual</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Received</div>'
    + '<div class="row-s">Planned ' + ugx(t.inc) + '</div></div>'
    + '<div class="row-v num pos">' + ugx(inA) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Spent</div>'
    + '<div class="row-s">Planned ' + ugx(t.out) + '</div></div>'
    + '<div class="row-v num neg">' + ugx(outA) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Actual net</div>'
    + '<div class="row-s">Against a plan of ' + ugx(t.net) + '</div></div>'
    + '<div class="row-v num ' + ((inA-outA)<0?'neg':'pos') + '">' + ugx(inA-outA) + '</div></div>';

  var el = document.getElementById('ledger-list');
  if (!S.ledger.length) {
    el.innerHTML = '<div class="empty"><b>No movements logged</b>The plan above is a forecast until you record what actually happened.</div>';
    return;
  }
  var recent = S.ledger.slice().sort(function(a,b){ return b.ts - a.ts; }).slice(0,60);
  el.innerHTML = '<div class="sec">Movements</div><div class="card">' + recent.map(function(e){
    var p = S.projects.find(function(x){ return x.id === e.projectId; });
    var v = (e.currency === 'USD') ? e.amount * rate() : e.amount;
    return '<div class="row"><div class="row-main"><div class="row-t">'
      + (e.type === 'credit' ? '+ ' : '− ') + esc(e.note || (e.type === 'credit' ? 'Receipt' : 'Payment'))
      + '</div><div class="row-s">' + new Date(e.ts).toLocaleDateString('en-GB',{day:'numeric',month:'short'})
      + (p ? ' · ' + esc(p.name) : '') + '</div></div>'
      + '<div class="row-v num ' + (e.type === 'credit' ? 'pos' : 'neg') + '">' + shortU(v)
      + '<small><button class="btn sm ghost" style="padding:2px 7px;margin-top:3px" onclick="delEntry(\''
      + e.id + '\')">Delete</button></small></div></div>';
  }).join('') + '</div>';
}

function renderDebts(){
  var t = debtTotals(), tt = totals();
  var el = document.getElementById('debt-summary');
  el.innerHTML = '<div class="card-h"><div class="card-t">The position</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Still outstanding</div>'
    + '<div class="row-s">' + t.count + ' debts'
    + (t.unknown ? ' · ' + t.unknown + ' with no balance entered yet' : '') + '</div></div>'
    + '<div class="row-v num neg">' + ugx(t.bal) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Instalments a month</div>'
    + '<div class="row-s">What you are currently paying</div></div>'
    + '<div class="row-v num">' + ugx(t.ins) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Cost of slipping one month</div>'
    + '<div class="row-s">Penalty on the balance above</div></div>'
    + '<div class="row-v num neg">' + ugx(t.delay) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Free and clear</div>'
    + '<div class="row-s">' + (t.longest ? 'If every instalment is met on time' : 'Enter balances to project this') + '</div></div>'
    + '<div class="row-v num au">' + (t.longest ? t.longest + ' mo' : '—') + '</div>'
    + '</div>'
    + (t.longest ? '<div class="mini" style="margin-top:9px">Clear by <b>' + freeByDate(t.longest)
        + '</b> on the present schedule.</div>' : '')
    + (t.delay > tt.recurNet && t.delay > 0
        ? '<div class="verdict v-bad" style="margin-top:12px">One month of delay costs <b>'
          + ugx(t.delay) + '</b>, which is more than your run rate of ' + ugx(Math.abs(tt.recurNet))
          + '. Slipping does not buy you time; it buys you a larger debt.</div>' : '');

  var list = document.getElementById('debt-list');
  if (!S.debts.length) {
    list.innerHTML = '<div class="empty"><b>No debts recorded</b>Add what you owe and the app will price delay for you.</div>';
    return;
  }
  var sorted = S.debts.slice().sort(function(a,b){ return debtStats(b).bal - debtStats(a).bal; });
  list.innerHTML = '<div class="sec">Each obligation</div><div class="card">' + sorted.map(function(d){
    var x = debtStats(d);
    var pill = x.unknown ? '<span class="pill p-gold">Balance not set</span>'
             : x.stuck   ? '<span class="pill p-bad">No instalment set</span>'
             : '<span class="pill p-mute">' + x.months + ' mo left</span>';
    var lf = debtFlow(d);
    return '<div class="row tap" onclick="editDebt(\'' + d.id + '\')">'
      + '<div class="row-main"><div class="row-t">' + esc(d.name) + '</div>'
      + '<div class="row-s">' + pill
      + '<span>' + ugx(x.ins) + '/mo · ' + Math.round(x.rate*100) + '% if late</span>'
      + (x.bal > 0 ? '<span>delay costs ' + ugx(x.delay) + '</span>' : '')
      + (lf ? '<span class="pill p-royal">paid via ' + esc(lf.name) + '</span>' : '') + '</div></div>'
      + '<div class="row-v num neg">' + (x.unknown ? '—' : shortU(x.bal)) + '<small>owing</small></div>'
      + '</div>';
  }).join('') + '</div>';
}

function editDebt(id){
  var d = id ? S.debts.find(function(x){ return x.id===id; })
             : { id:'', name:'', creditor:'', balance:'', instalment:'', rate:DEBT_RATE, note:'' };
  openSheet('<h2>' + (id?'Edit debt':'New debt') + '</h2>'
    + '<div class="sh-sub">What is still owed, and what late payment costs.</div>'
    + '<div class="f"><label>Name</label><input id="e-name" value="' + esc(d.name) + '"></div>'
    + '<div class="f"><label>Owed to</label><input id="e-cred" value="' + esc(d.creditor||'') + '" placeholder="Creditor"></div>'
    + '<div class="f2">'
      + '<div class="f"><label>Balance outstanding</label><input type="number" inputmode="numeric" id="e-bal" value="' + (d.balance||'') + '"></div>'
      + '<div class="f"><label>Instalment a month</label><input type="number" inputmode="numeric" id="e-ins" value="' + (d.instalment||'') + '"></div>'
    + '</div>'
    + '<div class="f"><label>Penalty if late (% a month)</label><input type="number" inputmode="decimal" step="0.5" id="e-rate" value="'
    + (((d.rate===undefined?DEBT_RATE:d.rate)*100)) + '">'
    + '<div class="hint">15% a month is 435% a year, and doubles a balance in five months.</div></div>'
    + '<div class="f"><label>Note</label><textarea id="e-note">' + esc(d.note||'') + '</textarea></div>'
    + (id && debtFlow(d) ? '<div class="sec">Serviced by</div><div class="card">'
        + '<div class="row tap" onclick="openRef(\'flow\',\'' + debtFlow(d).id + '\')">'
        + '<div class="row-main"><div class="row-t">' + esc(debtFlow(d).name) + '</div>'
        + '<div class="row-s">The outflow that pays this down</div></div>'
        + '<div class="row-v num neg">' + ugx(flowM(debtFlow(d))) + '</div><div class="chev">\u203a</div></div></div>' : '')
    + '<button class="btn au wide" onclick="saveDebt(\'' + (id||'') + '\')">Save debt</button>'
    + (id ? '<button class="btn danger wide" style="margin-top:9px" onclick="delDebt(\'' + id + '\')">Delete debt</button>' : '')
    + '<button class="btn ghost wide" style="margin-top:9px" onclick="closeSheet()">Cancel</button>');
}
function saveDebt(id){
  var g = function(x){ return document.getElementById(x).value; };
  if (!g('e-name').trim()) { toast('Give it a name'); return; }
  var o = { id:id||uid(), name:g('e-name').trim(), creditor:g('e-cred').trim(),
            balance:parseFloat(g('e-bal'))||0, instalment:parseFloat(g('e-ins'))||0,
            rate:(parseFloat(g('e-rate'))||0)/100, note:g('e-note').trim() };
  if (id) { var i = S.debts.findIndex(function(x){ return x.id===id; }); S.debts[i] = o; }
  else S.debts.push(o);
  persist(); closeSheet(); renderAll(); toast(id?'Debt updated':'Debt added');
}
function delDebt(id){
  S.debts = S.debts.filter(function(x){ return x.id!==id; });
  persist(); closeSheet(); renderAll(); toast('Debt deleted');
}

/* ============================================================
   RENDER — reserves
   ============================================================ */
function renderReserves(){
  var t = totals();
  var req = S.reserves.reduce(function(x,r){ return x + reserveMonthly(r); }, 0);
  var gap = req - t.net;
  document.getElementById('afford-card').innerHTML =
      '<div class="card-h"><div class="card-t">Can you afford your ambitions?</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Required each month</div>'
    + '<div class="row-s">To hit every dated goal on time</div></div>'
    + '<div class="row-v num au">' + ugx(req) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Surplus available</div>'
    + '<div class="row-s">Income less all outflows</div></div>'
    + '<div class="row-v num ' + (t.net<0?'neg':'pos') + '">' + ugx(t.net) + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">'
    + (gap > 0 ? 'Shortfall' : 'Headroom') + '</div>'
    + '<div class="row-s">' + (gap > 0
        ? 'Extend a date, cut an outflow, or lift income.'
        : 'Your goals fit inside your surplus.') + '</div></div>'
    + '<div class="row-v num ' + (gap>0?'neg':'pos') + '">' + ugx(Math.abs(gap)) + '</div></div>';

  var el = document.getElementById('res-list');
  if (!S.reserves.length) {
    el.innerHTML = '<div class="empty"><b>No reserves set</b>Name what you are building toward.</div>';
    return;
  }
  el.innerHTML = '<div class="card">' + S.reserves.map(function(r){
    var tg = reserveTarget(r), bal = +r.balance||0;
    var pc = tg ? Math.min(bal/tg*100, 100) : 0;
    var mo = reserveMonthly(r);
    return '<div class="row tap" onclick="editReserve(\'' + r.id + '\')">'
      + '<div class="row-main"><div class="row-t">' + esc(r.name)
      + (r.auto ? ' <span class="pill p-royal">Auto</span>' : '') + '</div>'
      + '<div class="bar"><i class="' + (pc>=100?'ok':'') + '" style="width:' + pc.toFixed(1) + '%"></i></div>'
      + '<div class="mini" style="margin-top:5px">' + ugx(bal) + ' of ' + ugx(tg)
      + (mo ? ' · needs ' + ugx(mo) + '/month' : (r.targetDate ? '' : ' · no date set')) + '</div></div>'
      + '<div class="row-v num au">' + pc.toFixed(0) + '%</div></div>';
  }).join('') + '</div>';
}

/* ============================================================
   RENDER — counsel
   ============================================================ */
function renderAdvisor(){
  var t = totals(), dt = debtTotals(), out = [];

  /* 1. the governing fact */
  out.push({r:['money','flows'], h:'The governing fact', b:
    'You earn ' + ugx(t.inc) + ' a month and spend ' + ugx(t.out) + '. That leaves ' + ugx(t.net)
    + ', which is ' + (t.inc ? Math.round(t.net/t.inc*100) : 0) + '% of everything that comes in. '
    + 'Every ambition below is rationed by that one number.'});

  /* 1b. the run rate */
  out.push({r:['money','sources'], h:'What happens when the one-offs stop', b:
    'Of the ' + ugx(t.inc) + ' arriving this month, only ' + ugx(t.recurIn)
    + ' repeats. Against ' + ugx(t.recurOut) + ' of recurring commitment that is a run rate of '
    + (t.recurNet < 0 ? '<b>minus ' + ugx(Math.abs(t.recurNet)) + ' a month</b>. '
        + 'The surplus you are looking at is a windfall, not an income. Treat every shilling of it '
        + 'as capital to be placed, because next month the arithmetic reverses.'
      : ugx(t.recurNet) + ' a month, which holds without windfalls.')});

  /* 1c. debt takes precedence */
  if (dt.count) {
    out.push({r:['money','debts'], h:'What the debts cost you', b: dt.bal
      ? 'You owe ' + ugx(dt.bal) + ' across ' + dt.count + ' obligations, against instalments of '
        + ugx(dt.ins) + ' a month. On schedule you are clear in ' + dt.longest + ' months — '
        + freeByDate(dt.longest) + '. Slip a single month and it costs ' + ugx(dt.delay)
        + '. At these rates no reserve, no venture and no campaign contribution earns anything '
        + 'close to what clearing the balance saves you. Debt first, and it is not a near thing.'
      : 'Eight obligations are recorded but no balances have been entered, so the app cannot '
        + 'price them. At 15% a month a balance doubles in five months — this is the single most '
        + 'valuable thing you can put into the app.'});
  }

  /* 2. concentration */
  var top = S.sources.slice().sort(function(a,b){ return srcM(b)-srcM(a); })[0];
  if (top && t.inc) {
    var share = srcM(top)/t.inc*100;
    out.push({r:['source',top.id], h:'Concentration', b:
      esc(top.name) + ' provides ' + Math.round(share) + '% of your income. '
      + (share > 70
        ? 'A single disruption there stops everything. Nothing else in your portfolio is yet earning at a scale that would cushion it.'
        : 'That is a tolerable spread, but watch it as the ventures grow.')});
  }

  /* 3. the ventures */
  var silent = S.projects.filter(function(p){ return projStats(p).inM === 0 && (p.weight||0) >= 3; });
  if (silent.length) out.push({r:['project',silent[0].id], h:'Ventures not yet paying', b:
    silent.map(function(p){ return p.name; }).join(', ')
    + ' carry high strategic weight but contribute nothing to the ledger. '
    + 'That is legitimate for an early venture and dangerous for a mature one. '
    + 'Give each a date by which it must show its first shilling.'});

  /* 4. unassigned money */
  if (t.unassigned > 0) out.push({r:['money','flows'], h:'Money you cannot account for', b:
    ugx(t.unassigned) + ' a month — ' + Math.round(t.unassigned/t.out*100)
    + '% of your outflow — is not attached to any project. '
    + 'Until it is tagged, you cannot say what it is buying, and no reallocation decision can be honest.'});

  /* 5. biggest drain */
  var drains = S.projects.map(function(p){ return {p:p, s:projStats(p)}; })
    .filter(function(x){ return x.s.net < 0; }).sort(function(a,b){ return a.s.net - b.s.net; });
  if (drains.length) out.push({r:['project',drains[0].p.id], h:'Largest net drain', b:
    drains[0].p.name + ' takes ' + ugx(Math.abs(drains[0].s.net))
    + ' a month more than it brings. Over the ' + months() + '-month period that is '
    + ugx(Math.abs(drains[0].s.net)*months()) + '. '
    + 'If it is strategic, say so and fund it deliberately. If it is drift, cut it.'});

  /* 6. FX */
  if (t.usdOut > 0) out.push({r:['money','flows'], h:'Currency risk', b:
    ugx(t.usdOut) + ' of monthly outflow is priced in dollars at a rate of ' + n0(rate())
    + '. A 10% move against the shilling costs ' + ugx(t.usdOut*0.1)
    + ' a month — ' + (t.net > 0 ? Math.round(t.usdOut*0.1/t.net*100) + '% of your entire surplus.'
                                 : 'straight onto an already negative position.')});

  /* 7. reserve */
  var resBal = S.reserves.reduce(function(x,r){ return x+(+r.balance||0); }, 0);
  var cover = t.out ? resBal/t.out : 0;
  out.push({r:['tab','reserves'], h:'If income stopped tomorrow', b:
    'You hold ' + ugx(resBal) + ' in reserves against ' + ugx(t.out) + ' of monthly commitment — '
    + cover.toFixed(1) + ' months of cover. '
    + (cover < 3 ? 'Before any new venture is capitalised, this is the first call on surplus.'
                 : 'That is a defensible position.')});

  /* 8. the long horizon */
  var camp = S.reserves.find(function(r){ return /campaign|2031/i.test(r.name); });
  if (camp) {
    var need = reserveMonthly(camp);
    out.push({r:['reserve',camp.id], h:'The 2031 horizon', b: need
      ? 'The campaign fund needs ' + ugx(need) + ' a month from today to reach '
        + ugx(reserveTarget(camp)) + ' by its date. That is '
        + (t.net > 0 ? Math.round(need/t.net*100) + '% of your current surplus.'
                     : 'not fundable from a negative surplus.')
      : 'The campaign fund has no target figure or no date. Until both exist it is an intention, not a plan.'});
  }

  document.getElementById('adv-list').innerHTML = out.map(function(o,i){
    var go = o.r ? ' tap" onclick="openRef(\'' + o.r[0] + '\',\'' + o.r[1] + '\')"' : '"';
    return '<div class="card' + go + '><div class="card-h"><div class="card-t">' + esc(o.h) + '</div>'
      + '<div class="mini num">' + String(i+1).padStart(2,'0') + '</div></div>'
      + '<div class="note">' + o.b + '</div>'
      + (o.r ? '<div class="mini au" style="margin-top:10px">Open the figures ›</div>' : '')
      + '</div>';
  }).join('');
}

/* ============================================================
   EDITORS
   ============================================================ */
function opts(list, sel){
  return list.map(function(o){
    var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
    return '<option value="' + esc(v) + '"' + (v===sel?' selected':'') + '>' + esc(l) + '</option>';
  }).join('');
}
function projOpts(sel){
  return '<option value="">— unassigned —</option>' + S.projects.map(function(p){
    return '<option value="' + p.id + '"' + (p.id===sel?' selected':'') + '>' + esc(p.name) + '</option>';
  }).join('');
}

/* ---- source ---- */
function editSource(id){
  var s = id ? S.sources.find(function(x){ return x.id===id; })
             : { id:'', name:'', payer:'', category:incomeCats()[0], currency:'UGX', amount:'',
                 cadence:'monthly', status:'expected', reliability:'likely', projectId:'',
                 date:'', note:'' };
  openSheet('<h2>' + (id?'Edit source':'New income source') + '</h2>'
    + '<div class="sh-sub">Where money comes from.</div>'
    + '<div class="f"><label>Name</label><input id="e-name" value="' + esc(s.name) + '" placeholder="Legal practice fees"></div>'
    + '<div class="f2">'
      + '<div class="f"><label>Payer</label><input id="e-payer" value="' + esc(s.payer) + '" placeholder="Who pays you"></div>'
      + '<div class="f"><label>Date received / due</label><input type="date" id="e-date" value="' + esc(s.date||'') + '"></div>'
    + '</div>'
    + '<div class="f"><label>Category</label><select id="e-cat">' + opts(incomeCats(), s.category) + '</select></div>'
    + '<div class="f3">'
      + '<div class="f"><label>Currency</label><select id="e-cur">' + opts(['UGX','USD'], s.currency) + '</select></div>'
      + '<div class="f"><label>Amount</label><input type="number" inputmode="decimal" id="e-amt" value="' + (s.amount||'') + '"></div>'
      + '<div class="f"><label>How often</label><select id="e-freq">' + opts(CADENCES, s.cadence) + '</select></div>'
    + '</div>'
    + '<div class="f2">'
      + '<div class="f"><label>Status</label><select id="e-status">' + opts(STATUSES.map(function(x){return [x,titleCase(x)];}), s.status) + '</select></div>'
      + '<div class="f"><label>How certain</label><select id="e-rel">' + opts(RELIABILITY.map(function(x){return [x,titleCase(x)];}), s.reliability) + '</select></div>'
    + '</div>'
    + '<div class="f"><label>Earned by which project</label><select id="e-proj">' + projOpts(s.projectId) + '</select>'
    + '<div class="hint">Attributing a source to a project is what makes that project show as a contributor.</div></div>'
    + '<div class="f"><label>Note</label><textarea id="e-note">' + esc(s.note||'') + '</textarea></div>'
    + '<button class="btn au wide" onclick="saveSource(\'' + (id||'') + '\')">Save source</button>'
    + (id ? '<button class="btn danger wide" style="margin-top:9px" onclick="delSource(\'' + id + '\')">Delete source</button>' : '')
    + '<button class="btn ghost wide" style="margin-top:9px" onclick="closeSheet()">Cancel</button>');
}
function saveSource(id){
  var g = function(x){ return document.getElementById(x).value; };
  if (!g('e-name').trim()) { toast('Give it a name'); return; }
  var o = { id: id || uid(), name:g('e-name').trim(), payer:g('e-payer').trim(), category:g('e-cat'),
            currency:g('e-cur'), amount:parseFloat(g('e-amt'))||0, cadence:g('e-freq'),
            status:g('e-status'), reliability:g('e-rel'), projectId:g('e-proj'),
            date:g('e-date'), note:g('e-note').trim() };
  if (id) { var i = S.sources.findIndex(function(x){ return x.id===id; }); S.sources[i] = o; }
  else S.sources.push(o);
  persist(); closeSheet(); migrate();
persist();
renderAll();
handleShare(); toast(id?'Source updated':'Source added');
}
function delSource(id){
  S.sources = S.sources.filter(function(x){ return x.id!==id; });
  S.projects.forEach(function(p){
    p.funding = (p.funding||[]).filter(function(f){ return f.sourceId!==id; });
  });
  persist(); closeSheet(); migrate();
persist();
renderAll();
handleShare(); toast('Source deleted');
}

/* ---- flow ---- */
function editFlow(id){
  var f = id ? S.flows.find(function(x){ return x.id===id; })
             : { id:'', name:'', currency:'UGX', amount:'', freq:'monthly', category:'',
                 nature:'', projectId:'', due:'', status:'pending' };
  openSheet('<h2>' + (id?'Edit outflow':'New outflow') + '</h2>'
    + '<div class="sh-sub">Where money goes.</div>'
    + '<div class="f"><label>Name</label><input id="e-name" value="' + esc(f.name) + '" placeholder="Rent"></div>'
    + '<div class="f3">'
      + '<div class="f"><label>Currency</label><select id="e-cur">' + opts(['UGX','USD'], f.currency) + '</select></div>'
      + '<div class="f"><label>Amount</label><input type="number" inputmode="decimal" id="e-amt" value="' + (f.amount||'') + '"></div>'
      + '<div class="f"><label>How often</label><select id="e-freq">' + opts(FREQS, f.freq) + '</select></div>'
    + '</div>'
    + '<div class="f2">'
      + '<div class="f"><label>Category</label><select id="e-cat"><option value="">— none —</option>' + opts(expenseCats(), f.category) + '</select></div>'
      + '<div class="f"><label>Nature</label><select id="e-nat"><option value="">— none —</option>' + opts(natures(), f.nature) + '</select></div>'
    + '</div>'
    + '<div class="f2">'
      + '<div class="f"><label>Next due</label><input type="date" id="e-due" value="' + esc(f.due||'') + '"></div>'
      + '<div class="f"><label>Status</label><select id="e-st">'
        + opts(FLOW_STATUS.map(function(x){ return [x, titleCase(x)]; }), f.status||'pending') + '</select></div>'
    + '</div>'
    + '<div class="f"><label>Belongs to which project</label><select id="e-proj">' + projOpts(f.projectId) + '</select>'
    + '<div class="hint">This is the link that lets you trace a project to its true cost.</div></div>'
    + (id ? relatedForFlow(f) : '')
    + '<button class="btn au wide" onclick="saveFlow(\'' + (id||'') + '\')">Save outflow</button>'
    + (id ? '<button class="btn danger wide" style="margin-top:9px" onclick="delFlow(\'' + id + '\')">Delete outflow</button>' : '')
    + '<button class="btn ghost wide" style="margin-top:9px" onclick="closeSheet()">Cancel</button>');
}
function relatedForFlow(f){
  var bits = [];
  var p = S.projects.find(function(x){ return x.id === f.projectId; });
  if (p) bits.push('<div class="row tap" onclick="openRef(\'project\',\'' + p.id + '\')">'
    + '<div class="row-main"><div class="row-t">' + esc(p.name) + '</div>'
    + '<div class="row-s">Trace the project this belongs to</div></div><div class="chev">\u203a</div></div>');
  var d = flowDebt(f);
  if (d) bits.push('<div class="row tap" onclick="openRef(\'debt\',\'' + d.id + '\')">'
    + '<div class="row-main"><div class="row-t">' + esc(d.name) + '</div>'
    + '<div class="row-s">The debt this instalment pays down</div></div><div class="chev">\u203a</div></div>');
  if (f.category) bits.push('<div class="row tap" onclick="categoryDrill(\'' + f.category.replace(/'/g,'') + '\')">'
    + '<div class="row-main"><div class="row-t">' + esc(f.category) + '</div>'
    + '<div class="row-s">Everything else in this category</div></div><div class="chev">\u203a</div></div>');
  if (!bits.length) return '';
  return '<div class="sec">Related</div><div class="card">' + bits.join('') + '</div>';
}

function saveFlow(id){
  var g = function(x){ return document.getElementById(x).value; };
  if (!g('e-name').trim()) { toast('Give it a name'); return; }
  var o = { id: id||uid(), name:g('e-name').trim(), currency:g('e-cur'),
            amount:parseFloat(g('e-amt'))||0, freq:g('e-freq'), category:g('e-cat'),
            nature:g('e-nat'), projectId:g('e-proj'),
            due:g('e-due'), status:g('e-st') };
  if (id) { var i = S.flows.findIndex(function(x){ return x.id===id; }); S.flows[i] = o; }
  else S.flows.push(o);
  persist(); closeSheet(); migrate();
persist();
renderAll();
handleShare(); toast(id?'Outflow updated':'Outflow added');
}
function delFlow(id){
  S.flows = S.flows.filter(function(x){ return x.id!==id; });
  persist(); closeSheet(); migrate();
persist();
renderAll();
handleShare(); toast('Outflow deleted');
}

/* ---- project ---- */
function editProject(id){
  var p = id ? S.projects.find(function(x){ return x.id===id; })
             : { id:'', name:'', docket:DOCKETS[0], weight:3, note:'', funding:[] };
  openSheet('<h2>' + (id?'Edit project':'New project') + '</h2>'
    + '<div class="sh-sub">An activity that costs money, earns it, or both.</div>'
    + '<div class="f"><label>Name</label><input id="e-name" value="' + esc(p.name) + '"></div>'
    + '<div class="f2">'
      + '<div class="f"><label>Docket</label><select id="e-dock">' + opts(DOCKETS, p.docket) + '</select></div>'
      + '<div class="f"><label>Strategic weight</label><select id="e-w">'
        + opts([['5','5 — decisive'],['4','4 — major'],['3','3 — real'],['2','2 — minor'],['1','1 — marginal']], String(p.weight)) + '</select></div>'
    + '</div>'
    + '<div class="f"><label>Note</label><textarea id="e-note">' + esc(p.note||'') + '</textarea></div>'
    + '<button class="btn au wide" onclick="saveProject(\'' + (id||'') + '\')">Save project</button>'
    + (id ? '<button class="btn danger wide" style="margin-top:9px" onclick="delProject(\'' + id + '\')">Delete project</button>' : '')
    + '<button class="btn ghost wide" style="margin-top:9px" onclick="closeSheet()">Cancel</button>');
}
function saveProject(id){
  var g = function(x){ return document.getElementById(x).value; };
  if (!g('e-name').trim()) { toast('Give it a name'); return; }
  if (id) {
    var p = S.projects.find(function(x){ return x.id===id; });
    p.name = g('e-name').trim(); p.docket = g('e-dock');
    p.weight = parseInt(g('e-w'),10); p.note = g('e-note').trim();
  } else {
    S.projects.push({ id:uid(), name:g('e-name').trim(), docket:g('e-dock'),
      weight:parseInt(g('e-w'),10), note:g('e-note').trim(), funding:[] });
  }
  persist(); closeSheet(); migrate();
persist();
renderAll();
handleShare(); toast(id?'Project updated':'Project added');
}
function delProject(id){
  S.projects = S.projects.filter(function(x){ return x.id!==id; });
  S.flows.forEach(function(f){ if (f.projectId===id) f.projectId=''; });
  S.sources.forEach(function(s){ if (s.projectId===id) s.projectId=''; });
  persist(); closeSheet(); migrate();
persist();
renderAll();
handleShare(); toast('Project deleted');
}

/* ---- reserve ---- */
function editReserve(id){
  var r = id ? S.reserves.find(function(x){ return x.id===id; })
             : { id:'', name:'', target:'', balance:'', targetDate:'', auto:false, note:'' };
  openSheet('<h2>' + (id?'Edit reserve':'New reserve or goal') + '</h2>'
    + '<div class="sh-sub">What you are building toward.</div>'
    + '<div class="f"><label>Name</label><input id="e-name" value="' + esc(r.name) + '"></div>'
    + '<div class="f2">'
      + '<div class="f"><label>Target (UGX)</label><input type="number" inputmode="numeric" id="e-tgt" value="' + (r.target||'') + '"' + (r.auto?' disabled':'') + '></div>'
      + '<div class="f"><label>Balance now (UGX)</label><input type="number" inputmode="numeric" id="e-bal" value="' + (r.balance||'') + '"></div>'
    + '</div>'
    + '<div class="f"><label>Target date</label><input type="date" id="e-date" value="' + esc(r.targetDate||'') + '">'
    + '<div class="hint">A date turns the goal into a monthly figure you can test against your surplus.</div></div>'
    + '<div class="f"><label><input type="checkbox" id="e-auto"' + (r.auto?' checked':'')
    + ' style="transform:scale(1.2);margin-right:8px">Track three months of outflows automatically</label></div>'
    + '<button class="btn au wide" onclick="saveReserve(\'' + (id||'') + '\')">Save reserve</button>'
    + (id ? '<button class="btn danger wide" style="margin-top:9px" onclick="delReserve(\'' + id + '\')">Delete reserve</button>' : '')
    + '<button class="btn ghost wide" style="margin-top:9px" onclick="closeSheet()">Cancel</button>');
}
function saveReserve(id){
  var g = function(x){ return document.getElementById(x).value; };
  if (!g('e-name').trim()) { toast('Give it a name'); return; }
  var o = { id:id||uid(), name:g('e-name').trim(), target:parseFloat(g('e-tgt'))||0,
            balance:parseFloat(g('e-bal'))||0, targetDate:g('e-date'),
            auto:document.getElementById('e-auto').checked, note:'' };
  if (id) { var i = S.reserves.findIndex(function(x){ return x.id===id; }); o.note = S.reserves[i].note||''; S.reserves[i]=o; }
  else S.reserves.push(o);
  persist(); closeSheet(); migrate();
persist();
renderAll();
handleShare(); toast(id?'Reserve updated':'Reserve added');
}
function delReserve(id){
  S.reserves = S.reserves.filter(function(x){ return x.id!==id; });
  persist(); closeSheet(); migrate();
persist();
renderAll();
handleShare(); toast('Reserve deleted');
}

/* ---- ledger entry ---- */
function editEntry(){
  openSheet('<h2>Log a movement</h2><div class="sh-sub">What actually happened, as against the plan.</div>'
    + '<div class="f2">'
      + '<div class="f"><label>Direction</label><select id="e-type">'
        + '<option value="credit">Money in</option><option value="debit">Money out</option></select></div>'
      + '<div class="f"><label>Currency</label><select id="e-cur">' + opts(['UGX','USD'],'UGX') + '</select></div>'
    + '</div>'
    + '<div class="f"><label>Amount</label><input type="number" inputmode="decimal" id="e-amt"></div>'
    + '<div class="f"><label>Project</label><select id="e-proj">' + projOpts('') + '</select></div>'
    + '<div class="f"><label>Note</label><input id="e-note" placeholder="What was it for"></div>'
    + '<button class="btn au wide" onclick="saveEntry()">Log movement</button>'
    + '<button class="btn ghost wide" style="margin-top:9px" onclick="closeSheet()">Cancel</button>');
}
function saveEntry(){
  var g = function(x){ return document.getElementById(x).value; };
  var a = parseFloat(g('e-amt'));
  if (!a || a <= 0) { toast('Enter an amount'); return; }
  S.ledger.push({ id:uid(), ts:Date.now(), type:g('e-type'), amount:a, currency:g('e-cur'),
                  projectId:g('e-proj'), note:g('e-note').trim() });
  persist(); closeSheet(); migrate();
persist();
renderAll();
handleShare(); toast('Movement logged');
}
function delEntry(id){
  S.ledger = S.ledger.filter(function(x){ return x.id!==id; });
  persist(); migrate();
persist();
renderAll();
handleShare(); toast('Movement deleted');
}

/* ============================================================
   SETTINGS, BACKUP, EXPORT
   ============================================================ */
function saveSettings(){
  var r = parseFloat(document.getElementById('set-rate').value);
  var m = parseFloat(document.getElementById('set-months').value);
  if (r > 0) S.settings.rate = r;
  if (m > 0) S.settings.months = m;
  persist(); migrate();
persist();
renderAll();
handleShare(); toast('Period saved');
}

function openSettings(){
  var t = totals();
  openSheet('<h2>Settings &amp; backup</h2>'
    + '<div class="sh-sub">Last saved ' + new Date(S.settings.updated).toLocaleString('en-GB') + '</div>'
    + '<div class="card"><div class="row"><div class="row-main"><div class="row-t">Records held</div>'
    + '<div class="row-s">' + S.sources.length + ' sources · ' + S.flows.length + ' outflows · '
    + S.projects.length + ' projects · ' + S.reserves.length + ' reserves · ' + S.ledger.length + ' movements</div></div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Build</div>'
    + '<div class="row-s">Check this matches the version you were sent</div></div>'
    + '<div class="row-v num au">' + BUILD + '</div></div>'
    + '<div class="row"><div class="row-main"><div class="row-t">Storage</div>'
    + '<div class="row-s">' + (storageOK() ? 'Saving to this device' : 'Preview only — install from your own site to save') + '</div></div></div></div>'
    + '<div class="sec">Health check</div>'
    + '<button class="btn wide" onclick="selfTest()">Test every screen</button>'
    + '<div id="selftest" class="mini" style="margin-top:10px"></div>'
    + '<div class="sec">Backup</div>'
    + '<div class="btn-row"><button class="btn au" onclick="exportJSON()">Download backup</button>'
    + '<button class="btn" onclick="document.getElementById(\'imp\').click()">Restore backup</button>'
    + '<button class="btn ghost" onclick="exportCSV()">Export to CSV</button></div>'
    + '<input type="file" id="imp" accept=".json" style="display:none" onchange="importJSON(this)">'
    + '<div class="hint" style="margin-top:9px">CSV opens in Excel alongside your July–August workbook.</div>'
    + '<div class="sec">Categories</div>'
    + '<div class="note" style="margin-bottom:11px">One per line. Renaming a category here does not '
    + 'rename it on records already saved — edit those records too.</div>'
    + '<div class="f"><label>Income categories</label><textarea id="cat-inc" style="min-height:110px">'
    + esc(incomeCats().join('\n')) + '</textarea></div>'
    + '<div class="f"><label>Expense categories</label><textarea id="cat-exp" style="min-height:130px">'
    + esc(expenseCats().join('\n')) + '</textarea></div>'
    + '<div class="f"><label>Nature of spend</label><textarea id="cat-nat" style="min-height:80px">'
    + esc(natures().join('\n')) + '</textarea></div>'
    + '<button class="btn au wide" onclick="saveCats()">Save categories</button>'
    + '<div class="sec">Danger</div>'
    + '<button class="btn danger wide" onclick="resetAll()">Reset to seeded figures</button>'
    + '<button class="btn ghost wide" style="margin-top:14px" onclick="closeSheet()">Close</button>');
}
function selfTest(){
  var screens = [['Position',renderPosition],['Projects',renderProjects],['Sources',renderSources],
                 ['Outflows',renderFlows],['Debts',renderDebts],['Actuals',renderLedger],
                 ['Reserves',renderReserves],['Counsel',renderAdvisor]];
  var keep = current, lines = [], bad = 0;
  screens.forEach(function(x){
    try { current = 'all'; x[1](); lines.push('\u2713 ' + x[0]); }
    catch(e){ bad++; lines.push('\u2717 ' + x[0] + ' \u2014 ' + esc(e.message)); }
  });
  current = keep;
  var counsel = 0;
  try { renderAdvisor(); counsel = document.getElementById('adv-list').children.length; } catch(e){}
  document.getElementById('selftest').innerHTML =
    '<b style="color:' + (bad ? 'var(--bad)' : 'var(--good)') + '">'
    + (bad ? bad + ' screen' + (bad>1?'s':'') + ' failing' : 'All 8 screens render')
    + '</b><br>' + lines.join('<br>')
    + '<br>Counsel is producing ' + counsel + ' cards.'
    + '<br>Build ' + BUILD;
  renderAll();
}

function storageOK(){
  try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; } catch(e){ return false; }
}
function download(name, text, mime){
  var b = new Blob([text], {type: mime||'application/json'});
  var u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  document.body.removeChild(a); setTimeout(function(){ URL.revokeObjectURL(u); }, 1500);
}
function exportJSON(){
  download('psos-backup-' + new Date().toISOString().slice(0,10) + '.json', JSON.stringify(S,null,2));
  toast('Backup downloaded');
}
function importJSON(input){
  var f = input.files[0]; if (!f) return;
  var r = new FileReader();
  r.onload = function(){
    try {
      var d = JSON.parse(r.result);
      if (!d || !d.sources || !d.flows) throw new Error('not a PSOS backup');
      S = d; if (S.v !== 3) S.v = 3;
      persist(); closeSheet(); migrate();
persist();
renderAll();
handleShare(); toast('Backup restored');
    } catch(e){ toast('That file is not a PSOS backup'); }
  };
  r.readAsText(f);
}
function exportCSV(){
  var L = [];
  L.push('SOURCES');
  L.push('Name,Payer,Category,Currency,Amount,Cadence,Status,Certainty,Monthly UGX,Earned by');
  S.sources.forEach(function(s){
    var p = S.projects.find(function(x){ return x.id===s.projectId; });
    L.push([s.name,s.payer,s.category,s.currency,s.amount,s.cadence,s.status,s.reliability,
            Math.round(srcM(s)), p?p.name:''].map(csvq).join(','));
  });
  L.push(''); L.push('OUTFLOWS');
  L.push('Name,Currency,Amount,Frequency,Category,Nature,Monthly UGX,Project');
  S.flows.forEach(function(f){
    var p = S.projects.find(function(x){ return x.id===f.projectId; });
    L.push([f.name,f.currency,f.amount,f.freq,f.category,f.nature,
            Math.round(flowM(f)), p?p.name:''].map(csvq).join(','));
  });
  L.push(''); L.push('PROJECTS');
  L.push('Name,Docket,Weight,Earns UGX,Allocated UGX,Costs UGX,Net UGX');
  S.projects.forEach(function(p){
    var st = projStats(p);
    L.push([p.name,p.docket,p.weight,Math.round(st.own),Math.round(st.alloc),
            Math.round(st.out),Math.round(st.net)].map(csvq).join(','));
  });
  L.push(''); L.push('RESERVES');
  L.push('Name,Target UGX,Balance UGX,Target date,Required monthly UGX');
  S.reserves.forEach(function(r){
    L.push([r.name,Math.round(reserveTarget(r)),r.balance,r.targetDate,
            Math.round(reserveMonthly(r))].map(csvq).join(','));
  });
  download('psos-export-' + new Date().toISOString().slice(0,10) + '.csv', L.join('\n'), 'text/csv');
  toast('CSV downloaded');
}
function csvq(v){
  v = (v==null) ? '' : String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v;
}
function resetAll(){
  if (!confirm('Reset every record to the seeded July–August figures? Download a backup first if you need one.')) return;
  S = seed(); persist(); closeSheet(); migrate();
persist();
renderAll();
handleShare(); toast('Reset to seed');
}

function saveCats(){
  var lines = function(id){
    return document.getElementById(id).value.split('\n')
      .map(function(x){ return x.trim(); }).filter(Boolean);
  };
  var i = lines('cat-inc'), e = lines('cat-exp'), n = lines('cat-nat');
  if (!i.length || !e.length || !n.length) { toast('Each list needs at least one entry'); return; }
  S.settings.cats = { income:i, expense:e, nature:n };
  persist(); closeSheet(); migrate();
persist();
renderAll();
handleShare(); toast('Categories saved');
}

/* ---------- share target: send a bank SMS to PSOS to log it ---------- */
function handleShare(){
  var q = new URLSearchParams(location.search);
  var txt = [q.get('share_title'), q.get('share_text'), q.get('share_url')]
              .filter(Boolean).join(' ').trim();
  if (!txt) return;
  history.replaceState(null, '', location.pathname);
  go('money'); moneyTab('ledger'); editEntry();
  var num = txt.replace(/,/g,'').match(/\d+(?:\.\d+)?/);
  var amt = document.getElementById('e-amt'), note = document.getElementById('e-note');
  if (num && amt) amt.value = num[0];
  if (note) note.value = txt.slice(0,120);
  if (/receiv|credit|deposit|paid you|salary/i.test(txt)) {
    var ty = document.getElementById('e-type'); if (ty) ty.value = 'credit';
  }
  toast('Check the amount, then log it');
}

/* ============================================================
   BOOT
   ============================================================ */
function safeRender(label, fn, elId){
  try { fn(); }
  catch(e){
    var el = elId && document.getElementById(elId);
    if (el) el.innerHTML = '<div class="verdict v-bad"><b>' + esc(label)
      + ' could not be drawn.</b><br>' + esc(e.message)
      + '<br><span class="mini">Build ' + BUILD + '</span></div>';
    if (window.console && console.error) console.error(label, e);
  }
}

function renderAll(){
  safeRender('Summary strip', renderStrip);
  if (current === 'position') safeRender('Position', renderPosition, 'alerts-card');
  if (current === 'projects') safeRender('Projects', renderProjects, 'proj-list');
  if (current === 'money'){
    safeRender('Sources', renderSources, 'src-list');
    safeRender('Outflows', renderFlows, 'flow-list');
    safeRender('Debts', renderDebts, 'debt-list');
    safeRender('Actuals', renderLedger, 'ledger-list');
  }
  if (current === 'reserves') safeRender('Reserves', renderReserves, 'res-list');
  if (current === 'advisor') safeRender('Counsel', renderAdvisor, 'adv-list');
}

document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') closeSheet();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js').catch(function(){});
  });
}

migrate();
persist();
renderAll();
handleShare();
