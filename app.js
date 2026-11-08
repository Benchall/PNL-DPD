'use strict';

/* ============================================================
   DPD P&L Tracker
   All data is stored in this browser (localStorage).
   ============================================================ */

const STORE_KEY = 'dpd-pnl-v1';
const DEPOTS = ['RAUNDS', 'GLENFIELD'];
const DEPOT_NAMES = { RAUNDS: 'Raunds', GLENFIELD: 'Glenfield' };
const COSTS = [
  ['charging', 'Charging'],
  ['vanHire', 'Van hire'],
  ['insurance', 'Insurance'],
  ['damages', 'Van damages'],
];

/* ---------- state ---------- */

function defaultState() {
  return {
    version: 1,
    settings: {
      periodAnchor: mondayOf(todayStr()),
      depotRates: { RAUNDS: 0, GLENFIELD: 0 },
    },
    fds: [],
    entries: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.version) return normalise(s);
    }
  } catch (e) { /* storage unavailable or corrupt */ }
  return defaultState();
}

function normalise(s) {
  const d = defaultState();
  s.settings = Object.assign({}, d.settings, s.settings || {});
  s.settings.depotRates = Object.assign({}, d.settings.depotRates, s.settings.depotRates || {});
  s.fds = Array.isArray(s.fds) ? s.fds : [];
  s.entries = Array.isArray(s.entries) ? s.entries : [];
  return s;
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save — browser storage is unavailable. Download a backup!');
  }
}

let state = loadState();

const ui = {
  view: 'week',
  date: todayStr(),
  scope: 'ALL',
  dayDate: todayStr(),
  dayDepot: 'ALL',
};

/* ---------- helpers ---------- */

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
}
function fromDay(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
function mondayOf(s) {
  const n = toDay(s);
  const dow = (new Date(n * 864e5).getUTCDay() + 6) % 7; // Mon = 0
  return fromDay(n - dow);
}
function mod(a, b) { return ((a % b) + b) % b; }
function fmtDate(s, opts) {
  return new Date(toDay(s) * 864e5).toLocaleDateString('en-GB',
    Object.assign({ timeZone: 'UTC', day: '2-digit', month: 'short' }, opts || {}));
}
function fmtDateLong(s) { return fmtDate(s, { weekday: 'short', year: 'numeric' }); }

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
function money(v) { return gbp.format(v || 0); }
function moneyCell(v, signed) {
  const cls = signed ? (v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : '') : '';
  return `<td class="${cls}">${money(v)}</td>`;
}
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
function pct(v) { return isFinite(v) ? (v * 100).toFixed(1) + '%' : '—'; }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function $(id) { return document.getElementById(id); }

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function fdById(id) { return state.fds.find(f => f.id === id); }
function fdLabel(f) { return f ? f.code : 'Unknown FD'; }
function depotBadge(d) {
  return `<span class="badge ${d === 'RAUNDS' ? 'R' : 'G'}">${esc(DEPOT_NAMES[d] || d)}</span>`;
}
function rateFor(fd) {
  if (fd && fd.rate !== '' && fd.rate != null && isFinite(parseFloat(fd.rate))) return parseFloat(fd.rate);
  return num(state.settings.depotRates[fd ? fd.depot : 'RAUNDS']);
}
function sortFds(list) {
  return list.slice().sort((a, b) =>
    a.depot.localeCompare(b.depot) || a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/* ---------- periods ---------- */

function periodInfo(dateStr) {
  const anchor = toDay(state.settings.periodAnchor);
  const off = toDay(dateStr) - anchor;
  const pIdx = Math.floor(off / 28);
  return {
    periodNo: pIdx + 1,
    periodStart: anchor + pIdx * 28,
    weekNo: Math.floor(mod(off, 28) / 7) + 1,
    weekStart: anchor + Math.floor(off / 7) * 7,
  };
}

function rangeFor(view, dateStr) {
  const p = periodInfo(dateStr);
  if (view === 'day') { const d = toDay(dateStr); return [d, d]; }
  if (view === 'week') return [p.weekStart, p.weekStart + 6];
  return [p.periodStart, p.periodStart + 27];
}

/* ---------- aggregation ---------- */

function entryRevenue(e) { return num(e.routes) * num(e.rate); }
function entryCosts(e) { return COSTS.reduce((s, [k]) => s + num(e[k]), 0); }

function agg(list) {
  const t = { routes: 0, revenue: 0, charging: 0, vanHire: 0, insurance: 0, damages: 0, days: new Set(), count: list.length };
  for (const e of list) {
    t.routes += num(e.routes);
    t.revenue += entryRevenue(e);
    for (const [k] of COSTS) t[k] += num(e[k]);
    if (num(e.routes) > 0) t.days.add(e.date);
  }
  t.costs = t.charging + t.vanHire + t.insurance + t.damages;
  t.profit = t.revenue - t.costs;
  t.rpr = t.routes ? t.revenue / t.routes : 0;
  t.cpr = t.routes ? t.costs / t.routes : 0;
  t.ppr = t.routes ? t.profit / t.routes : 0;
  t.margin = t.revenue ? t.profit / t.revenue : NaN;
  t.workDays = t.days.size;
  return t;
}

function entriesBetween(s, e) {
  return state.entries.filter(x => { const d = toDay(x.date); return d >= s && d <= e; });
}

function matchScope(scope) {
  if (scope === 'ALL') return () => true;
  if (scope.startsWith('D:')) { const d = scope.slice(2); return e => e.depot === d; }
  if (scope.startsWith('F:')) { const id = scope.slice(2); return e => e.fdId === id; }
  return () => true;
}

function scopeName(scope) {
  if (scope === 'ALL') return 'All depots combined';
  if (scope.startsWith('D:')) return DEPOT_NAMES[scope.slice(2)] + ' depot';
  const f = fdById(scope.slice(2));
  return f ? `${f.code} · ${f.email}` : 'FD';
}

/* ---------- table builders ---------- */

const METRIC_HEAD = '<th>Routes</th><th>Revenue</th><th>Rev / route</th><th>Charging</th><th>Van hire</th><th>Insurance</th><th>Damages</th><th>Total costs</th><th>Profit</th><th>Profit / route</th><th>Margin</th>';

function metricCells(t) {
  return `<td>${t.routes}</td>${moneyCell(t.revenue)}${moneyCell(t.rpr)}` +
    COSTS.map(([k]) => moneyCell(t[k])).join('') +
    `${moneyCell(t.costs)}${moneyCell(t.profit, true)}${moneyCell(t.ppr, true)}<td>${pct(t.margin)}</td>`;
}

const METRIC_CSV_HEAD = ['Routes', 'Revenue', 'Revenue per route', 'Charging', 'Van hire', 'Insurance', 'Van damages', 'Total costs', 'Profit', 'Profit per route', 'Margin %'];
function metricCsv(t) {
  const r = v => (Math.round(v * 100) / 100).toFixed(2);
  return [t.routes, r(t.revenue), r(t.rpr), r(t.charging), r(t.vanHire), r(t.insurance), r(t.damages), r(t.costs), r(t.profit), r(t.ppr),
    isFinite(t.margin) ? (t.margin * 100).toFixed(1) : ''];
}

/* ---------- scope selects ---------- */

function fillScopeSelect(sel, value) {
  const opts = [['ALL', 'All depots combined']];
  for (const d of DEPOTS) opts.push(['D:' + d, DEPOT_NAMES[d] + ' depot']);
  const groups = DEPOTS.map(d => {
    const fds = sortFds(state.fds.filter(f => f.depot === d));
    if (!fds.length) return '';
    return `<optgroup label="${DEPOT_NAMES[d]} FDs">` +
      fds.map(f => `<option value="F:${esc(f.id)}">${esc(f.code)} · ${esc(f.email)}${f.active === false ? ' (inactive)' : ''}</option>`).join('') +
      '</optgroup>';
  }).join('');
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('') + groups;
  sel.value = value;
  if (sel.value !== value) sel.value = 'ALL';
}

/* ============================================================
   DASHBOARD
   ============================================================ */

function renderDashboard() {
  fillScopeSelect($('scopeSel'), ui.scope);
  ui.scope = $('scopeSel').value;
  $('dashDate').value = ui.date;
  document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === ui.view));

  const [s, e] = rangeFor(ui.view, ui.date);
  const p = periodInfo(ui.date);
  let title;
  if (ui.view === 'day') title = `${fmtDateLong(ui.date)} <span class="muted">· P${p.periodNo} W${p.weekNo}</span>`;
  else if (ui.view === 'week') title = `Week ${p.weekNo} of period ${p.periodNo} <span class="muted">· ${fmtDate(fromDay(s))} – ${fmtDate(fromDay(e), { year: 'numeric' })}</span>`;
  else title = `Period ${p.periodNo} <span class="muted">· ${fmtDate(fromDay(s))} – ${fmtDate(fromDay(e), { year: 'numeric' })} (4 weeks)</span>`;
  $('rangeTitle').innerHTML = `${esc(scopeName(ui.scope))} — ${title}`;

  const inRange = entriesBetween(s, e);
  const scoped = inRange.filter(matchScope(ui.scope));
  const t = agg(scoped);

  // KPIs
  const kpi = (label, value, note, cls, big) =>
    `<div class="kpi${big ? ' big' : ''}"><div class="label">${label}</div><div class="value ${cls || ''}">${value}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
  $('kpis').innerHTML = [
    kpi('Profit', money(t.profit), `Margin ${pct(t.margin)}`, t.profit >= 0 ? 'pos' : 'neg', true),
    kpi('Revenue', money(t.revenue), '', '', true),
    kpi('Routes completed', t.routes, t.workDays ? `${t.workDays} working day${t.workDays === 1 ? '' : 's'}` : ''),
    kpi('Revenue per route', money(t.rpr)),
    kpi('Profit per route', money(t.ppr), '', t.ppr >= 0 ? 'pos' : 'neg'),
    kpi('Total costs', money(t.costs), `${money(t.cpr)} per route`),
    kpi('Charging', money(t.charging)),
    kpi('Van hire', money(t.vanHire)),
    kpi('Insurance', money(t.insurance)),
    kpi('Van damages', money(t.damages)),
  ].join('');

  // Depot table (always shows both + combined for the selected time range)
  const depotScope = ui.scope.startsWith('D:') ? ui.scope.slice(2) :
    ui.scope.startsWith('F:') ? (fdById(ui.scope.slice(2)) || {}).depot : null;
  let html = `<thead><tr><th class="l">Depot</th>${METRIC_HEAD}</tr></thead><tbody>`;
  for (const d of DEPOTS) {
    const dt = agg(inRange.filter(x => x.depot === d));
    html += `<tr class="click${depotScope === d ? ' sel' : ''}" data-scope="D:${d}"><td>${depotBadge(d)}</td>${metricCells(dt)}</tr>`;
  }
  html += `<tr class="total click${ui.scope === 'ALL' ? ' sel' : ''}" data-scope="ALL"><td>Combined</td>${metricCells(agg(inRange))}</tr></tbody>`;
  $('depotTable').innerHTML = html;

  // FD table
  let fds = state.fds.slice();
  const withData = new Set(inRange.map(x => x.fdId));
  fds = fds.filter(f => f.active !== false || withData.has(f.id));
  if (depotScope) fds = fds.filter(f => f.depot === depotScope || inRange.some(x => x.fdId === f.id && x.depot === depotScope));
  const fdFilter = depotScope ? (x => x.depot === depotScope) : (() => true);
  fds = sortFds(fds);
  $('fdTableTitle').textContent = depotScope ? `FD breakdown — ${DEPOT_NAMES[depotScope]}` : 'FD breakdown — both depots';
  html = `<thead><tr><th class="l">FD / email</th><th class="l">Depot</th>${METRIC_HEAD}</tr></thead><tbody>`;
  if (!fds.length) {
    html += `<tr><td colspan="13" class="l muted">No FDs yet — add them under “FDs &amp; settings”.</td></tr>`;
  }
  for (const f of fds) {
    const ft = agg(inRange.filter(x => x.fdId === f.id && fdFilter(x)));
    html += `<tr class="click${ui.scope === 'F:' + f.id ? ' sel' : ''}" data-scope="F:${esc(f.id)}"><td class="l"><div class="fdname">${esc(f.code)}</div><div class="email">${esc(f.email)}</div></td><td class="l">${depotBadge(f.depot)}</td>${metricCells(ft)}</tr>`;
  }
  if (fds.length) html += `<tr class="total"><td>Total</td><td></td>${metricCells(agg(inRange.filter(fdFilter)))}</tr>`;
  $('fdTable').innerHTML = html + '</tbody>';

  // Time breakdown
  renderTimeBreakdown(s, e, scoped);
}

function renderTimeBreakdown(s, e, scoped) {
  const wrap2 = $('timeTable2Wrap');
  if (ui.view === 'day') {
    $('timeTitle').textContent = 'Entries on this day';
    let html = `<thead><tr><th class="l">FD / email</th><th class="l">Depot</th>${METRIC_HEAD}<th class="l">Notes</th></tr></thead><tbody>`;
    const rows = scoped.slice().sort((a, b) => a.depot.localeCompare(b.depot) || fdLabel(fdById(a.fdId)).localeCompare(fdLabel(fdById(b.fdId))));
    if (!rows.length) html += `<tr><td colspan="14" class="l muted">Nothing entered for this day. Use “Daily entry” to add it.</td></tr>`;
    for (const r of rows) {
      const f = fdById(r.fdId);
      html += `<tr><td class="l"><div class="fdname">${esc(fdLabel(f))}</div><div class="email">${esc(f ? f.email : '')}</div></td><td class="l">${depotBadge(r.depot)}</td>${metricCells(agg([r]))}<td class="l">${esc(r.notes || '')}</td></tr>`;
    }
    if (rows.length) html += `<tr class="total"><td>Total</td><td></td>${metricCells(agg(rows))}<td></td></tr>`;
    $('timeTable').innerHTML = html + '</tbody>';
    wrap2.hidden = true;
    return;
  }

  const dayRows = [];
  for (let d = s; d <= e; d++) {
    const ds = fromDay(d);
    const dt = agg(scoped.filter(x => x.date === ds));
    dayRows.push(`<tr class="click${dt.count ? '' : ' muted'}" data-day="${ds}"><td>${fmtDate(ds, { weekday: 'short' })}</td>${metricCells(dt)}</tr>`);
  }
  const dayTable = `<thead><tr><th class="l">Day</th>${METRIC_HEAD}</tr></thead><tbody>${dayRows.join('')}<tr class="total"><td>Total</td>${metricCells(agg(scoped))}</tr></tbody>`;

  if (ui.view === 'week') {
    $('timeTitle').textContent = 'Daily breakdown for this week';
    $('timeTable').innerHTML = dayTable;
    wrap2.hidden = true;
  } else {
    $('timeTitle').textContent = 'Weekly & daily breakdown for this period';
    let html = `<thead><tr><th class="l">Week</th>${METRIC_HEAD}</tr></thead><tbody>`;
    for (let w = 0; w < 4; w++) {
      const ws = s + w * 7, we = ws + 6;
      const wt = agg(scoped.filter(x => { const d = toDay(x.date); return d >= ws && d <= we; }));
      html += `<tr class="click" data-week="${fromDay(ws)}"><td>W${w + 1} <span class="muted">${fmtDate(fromDay(ws))}</span></td>${metricCells(wt)}</tr>`;
    }
    html += `<tr class="total"><td>Period total</td>${metricCells(agg(scoped))}</tr></tbody>`;
    $('timeTable').innerHTML = html;
    $('timeTable2').innerHTML = dayTable;
    wrap2.hidden = false;
  }
}

function exportReport() {
  const [s, e] = rangeFor(ui.view, ui.date);
  const inRange = entriesBetween(s, e);
  const rows = [];
  rows.push(['DPD P&L report', scopeName(ui.scope), `${fromDay(s)} to ${fromDay(e)}`]);
  rows.push([]);
  rows.push(['Depot', ...METRIC_CSV_HEAD]);
  for (const d of DEPOTS) rows.push([DEPOT_NAMES[d], ...metricCsv(agg(inRange.filter(x => x.depot === d)))]);
  rows.push(['Combined', ...metricCsv(agg(inRange))]);
  rows.push([]);
  rows.push(['FD', 'Email', 'Depot', ...METRIC_CSV_HEAD]);
  for (const f of sortFds(state.fds)) {
    const list = inRange.filter(x => x.fdId === f.id);
    if (!list.length && f.active === false) continue;
    rows.push([f.code, f.email, DEPOT_NAMES[f.depot], ...metricCsv(agg(list))]);
  }
  const scoped = inRange.filter(matchScope(ui.scope));
  rows.push([]);
  rows.push([`Daily — ${scopeName(ui.scope)}`]);
  rows.push(['Date', ...METRIC_CSV_HEAD]);
  for (let d = s; d <= e; d++) {
    const ds = fromDay(d);
    rows.push([ds, ...metricCsv(agg(scoped.filter(x => x.date === ds)))]);
  }
  downloadCsv(rows, `dpd-report-${ui.view}-${fromDay(s)}.csv`);
}

/* ============================================================
   DAILY ENTRY
   ============================================================ */

function renderDaily() {
  $('dayDate').value = ui.dayDate;
  $('dayDepot').value = ui.dayDepot;
  const existing = state.entries.filter(x => x.date === ui.dayDate);
  const byFd = new Map(existing.map(x => [x.fdId, x]));
  let fds = state.fds.filter(f => f.active !== false || byFd.has(f.id));
  if (ui.dayDepot !== 'ALL') fds = fds.filter(f => f.depot === ui.dayDepot);
  fds = sortFds(fds);

  $('dayEmpty').hidden = state.fds.length > 0;
  const v = x => (x === 0 || x ? x : '');
  $('dayCards').innerHTML = fds.map(f => {
    const e = byFd.get(f.id) || {};
    const rate = e.id ? e.rate : rateFor(f);
    return `<div class="daycard${e.id ? ' filled' : ''}" data-fd="${esc(f.id)}">
      <header>
        <div><div class="fdname">${esc(f.code)}${f.driver ? ` <span class="muted">· ${esc(f.driver)}</span>` : ''}</div><div class="email">${esc(f.email)}</div></div>
        ${depotBadge(f.depot)}
      </header>
      <div class="fields">
        <label>Routes<input type="number" inputmode="numeric" min="0" step="1" name="routes" value="${v(e.routes)}"></label>
        <label>Rate / route £<input type="number" inputmode="decimal" min="0" step="0.01" name="rate" value="${v(rate)}"></label>
        <label>Charging £<input type="number" inputmode="decimal" min="0" step="0.01" name="charging" value="${v(e.charging)}"></label>
        <label>Van hire £<input type="number" inputmode="decimal" min="0" step="0.01" name="vanHire" value="${v(e.vanHire)}"></label>
        <label>Insurance £<input type="number" inputmode="decimal" min="0" step="0.01" name="insurance" value="${v(e.insurance)}"></label>
        <label>Van damages £<input type="number" inputmode="decimal" min="0" step="0.01" name="damages" value="${v(e.damages)}"></label>
        <label class="notes">Notes<input type="text" name="notes" value="${esc(e.notes || '')}" placeholder="optional"></label>
      </div>
      <div class="calc"></div>
    </div>`;
  }).join('');
  if (state.fds.length && !fds.length) $('dayCards').innerHTML = '<div class="empty card">No active FDs at this depot.</div>';
  document.querySelectorAll('.daycard').forEach(updateCardCalc);
  updateDayTotals();
}

function readCard(card) {
  const g = n => card.querySelector(`[name="${n}"]`).value;
  return {
    routes: g('routes'), rate: g('rate'), charging: g('charging'), vanHire: g('vanHire'),
    insurance: g('insurance'), damages: g('damages'), notes: g('notes').trim(),
  };
}

function cardIsBlank(d) {
  return ['routes', 'charging', 'vanHire', 'insurance', 'damages'].every(k => d[k] === '' || num(d[k]) === 0) && !d.notes;
}

function updateCardCalc(card) {
  const d = readCard(card);
  const t = agg([d]);
  card.querySelector('.calc').innerHTML = cardIsBlank(d) ? '<span class="muted">Not entered</span>' :
    `<span>Revenue <b>${money(t.revenue)}</b></span><span>Costs <b>${money(t.costs)}</b></span><span>Profit <b class="${t.profit >= 0 ? 'pos' : 'neg'}">${money(t.profit)}</b></span>`;
}

function updateDayTotals() {
  const list = [...document.querySelectorAll('.daycard')].map(readCard).filter(d => !cardIsBlank(d));
  const t = agg(list);
  $('dayTotals').innerHTML = `<b>${t.routes}</b> routes · Revenue <b>${money(t.revenue)}</b> · Costs <b>${money(t.costs)}</b> · Profit <b class="${t.profit >= 0 ? 'pos' : 'neg'}">${money(t.profit)}</b>`;
}

function saveDay() {
  const date = ui.dayDate;
  let saved = 0, removed = 0;
  document.querySelectorAll('.daycard').forEach(card => {
    const fdId = card.dataset.fd;
    const f = fdById(fdId);
    const d = readCard(card);
    const idx = state.entries.findIndex(x => x.date === date && x.fdId === fdId);
    if (cardIsBlank(d)) {
      if (idx >= 0) { state.entries.splice(idx, 1); removed++; }
      return;
    }
    const entry = {
      id: idx >= 0 ? state.entries[idx].id : uid(),
      date, fdId,
      depot: idx >= 0 ? state.entries[idx].depot : f.depot,
      routes: Math.max(0, Math.round(num(d.routes))),
      rate: num(d.rate),
      charging: num(d.charging), vanHire: num(d.vanHire), insurance: num(d.insurance), damages: num(d.damages),
      notes: d.notes,
    };
    if (idx >= 0) state.entries[idx] = entry; else state.entries.push(entry);
    saved++;
  });
  saveState();
  toast(`Saved ${fmtDateLong(date)} — ${saved} FD${saved === 1 ? '' : 's'}${removed ? `, ${removed} cleared` : ''}`);
  renderDaily();
}

/* ============================================================
   ENTRIES
   ============================================================ */

let entScope = 'ALL';
function renderEntries() {
  fillScopeSelect($('entScope'), entScope);
  entScope = $('entScope').value;
  if (!$('entFrom').value) {
    const [s] = rangeFor('period', todayStr());
    $('entFrom').value = fromDay(s);
    $('entTo').value = fromDay(s + 27);
  }
  const list = filteredEntries();
  let html = `<thead><tr><th class="l">Date</th><th class="l">FD / email</th><th class="l">Depot</th><th>Routes</th><th>Rate</th><th>Revenue</th><th>Charging</th><th>Van hire</th><th>Insurance</th><th>Damages</th><th>Profit</th><th class="l">Notes</th><th></th></tr></thead><tbody>`;
  if (!list.length) html += `<tr><td colspan="13" class="l muted">No entries in this range.</td></tr>`;
  for (const e of list) {
    const f = fdById(e.fdId);
    const t = agg([e]);
    html += `<tr><td class="l">${fmtDate(e.date, { weekday: 'short', year: '2-digit' })}</td>
      <td class="l"><div class="fdname">${esc(fdLabel(f))}</div><div class="email">${esc(f ? f.email : '')}</div></td>
      <td class="l">${depotBadge(e.depot)}</td><td>${e.routes}</td>${moneyCell(e.rate)}${moneyCell(t.revenue)}
      ${COSTS.map(([k]) => moneyCell(e[k])).join('')}${moneyCell(t.profit, true)}
      <td class="l">${esc(e.notes || '')}</td>
      <td><button class="link" data-edit="${esc(e.date)}">Edit</button><button class="link" data-del="${esc(e.id)}">Delete</button></td></tr>`;
  }
  if (list.length) {
    const t = agg(list);
    html += `<tr class="total"><td>Total</td><td></td><td></td><td>${t.routes}</td>${moneyCell(t.rpr)}${moneyCell(t.revenue)}${COSTS.map(([k]) => moneyCell(t[k])).join('')}${moneyCell(t.profit, true)}<td></td><td></td></tr>`;
  }
  $('entTable').innerHTML = html + '</tbody>';
}

function filteredEntries() {
  const from = $('entFrom').value, to = $('entTo').value;
  const s = from ? toDay(from) : -Infinity, e = to ? toDay(to) : Infinity;
  return state.entries
    .filter(x => { const d = toDay(x.date); return d >= s && d <= e; })
    .filter(matchScope(entScope))
    .sort((a, b) => b.date.localeCompare(a.date) || a.depot.localeCompare(b.depot) || fdLabel(fdById(a.fdId)).localeCompare(fdLabel(fdById(b.fdId))));
}

function exportEntries() {
  const rows = [['Date', 'Period', 'Week', 'Depot', 'FD', 'Email', 'Routes', 'Rate per route', 'Revenue', 'Charging', 'Van hire', 'Insurance', 'Van damages', 'Total costs', 'Profit', 'Notes']];
  for (const e of filteredEntries().slice().reverse()) {
    const f = fdById(e.fdId); const p = periodInfo(e.date); const t = agg([e]);
    rows.push([e.date, p.periodNo, p.weekNo, DEPOT_NAMES[e.depot], fdLabel(f), f ? f.email : '', e.routes, e.rate,
      t.revenue.toFixed(2), e.charging, e.vanHire, e.insurance, e.damages, t.costs.toFixed(2), t.profit.toFixed(2), e.notes || '']);
  }
  downloadCsv(rows, `dpd-entries-${$('entFrom').value || 'all'}-to-${$('entTo').value || 'all'}.csv`);
}

/* ============================================================
   SETTINGS / FDs
   ============================================================ */

function renderSettings() {
  $('rateRAUNDS').value = state.settings.depotRates.RAUNDS || '';
  $('rateGLENFIELD').value = state.settings.depotRates.GLENFIELD || '';
  $('periodAnchor').value = state.settings.periodAnchor;

  let html = `<thead><tr><th class="l">FD</th><th class="l">Email</th><th class="l">Depot</th><th class="l">Driver</th><th>Rate / route</th><th>Van hire / day</th><th>Insurance / day</th><th class="l">Status</th><th></th></tr></thead><tbody>`;
  const fds = sortFds(state.fds);
  if (!fds.length) html += `<tr><td colspan="9" class="l muted">No FDs yet. Add your first one below.</td></tr>`;
  for (const f of fds) {
    const hasRate = f.rate !== '' && f.rate != null;
    html += `<tr><td class="l fdname">${esc(f.code)}</td><td class="l">${esc(f.email)}</td><td class="l">${depotBadge(f.depot)}</td><td class="l">${esc(f.driver || '')}</td>
      <td>${hasRate ? money(f.rate) : `<span class="muted">${money(rateFor(f))} (depot)</span>`}</td>
      ${moneyCell(f.vanHire)}${moneyCell(f.insurance)}
      <td class="l">${f.active === false ? '<span class="muted">Inactive</span>' : 'Active'}</td>
      <td><button class="link" data-fdedit="${esc(f.id)}">Edit</button><button class="link" data-fddel="${esc(f.id)}">Delete</button></td></tr>`;
  }
  $('fdList').innerHTML = html + '</tbody>';
}

function resetFdForm() {
  $('fdForm').reset();
  $('fdId').value = '';
  $('fdActive').checked = true;
  $('fdSubmit').textContent = 'Add FD';
  $('fdCancel').hidden = true;
}

function editFd(id) {
  const f = fdById(id); if (!f) return;
  $('fdId').value = f.id;
  $('fdCode').value = f.code;
  $('fdEmail').value = f.email;
  $('fdDepot').value = f.depot;
  $('fdDriver').value = f.driver || '';
  $('fdRate').value = f.rate === '' || f.rate == null ? '' : f.rate;
  $('fdVan').value = f.vanHire || '';
  $('fdIns').value = f.insurance || '';
  $('fdActive').checked = f.active !== false;
  $('fdSubmit').textContent = 'Save FD';
  $('fdCancel').hidden = false;
  $('fdCode').focus();
  $('fdForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function submitFd(ev) {
  ev.preventDefault();
  const id = $('fdId').value;
  const code = $('fdCode').value.trim();
  const email = $('fdEmail').value.trim();
  if (!code || !email) return;
  const dup = state.fds.find(f => f.id !== id && (f.code.toLowerCase() === code.toLowerCase() || f.email.toLowerCase() === email.toLowerCase()));
  if (dup && !confirm(`${dup.code} (${dup.email}) already uses that FD or email. Save anyway?`)) return;
  const data = {
    code, email,
    depot: $('fdDepot').value,
    driver: $('fdDriver').value.trim(),
    rate: $('fdRate').value === '' ? '' : num($('fdRate').value),
    vanHire: num($('fdVan').value),
    insurance: num($('fdIns').value),
    active: $('fdActive').checked,
  };
  if (id) {
    const f = fdById(id);
    if (f.depot !== data.depot && state.entries.some(x => x.fdId === id) &&
      confirm(`Move all of ${code}'s past entries to ${DEPOT_NAMES[data.depot]} too?\n\nOK = move history, Cancel = keep past entries at ${DEPOT_NAMES[f.depot]} (only new entries go to ${DEPOT_NAMES[data.depot]}).`)) {
      state.entries.forEach(x => { if (x.fdId === id) x.depot = data.depot; });
    }
    Object.assign(f, data);
    toast(`Updated ${code}`);
  } else {
    state.fds.push(Object.assign({ id: uid() }, data));
    toast(`Added ${code}`);
  }
  saveState();
  resetFdForm();
  renderSettings();
}

function deleteFd(id) {
  const f = fdById(id); if (!f) return;
  const n = state.entries.filter(x => x.fdId === id).length;
  if (n) {
    if (!confirm(`${f.code} has ${n} entr${n === 1 ? 'y' : 'ies'}. Deleting the FD also deletes those entries.\n\nTip: edit the FD and untick “Active” instead to keep its history.\n\nDelete anyway?`)) return;
  } else if (!confirm(`Delete ${f.code}?`)) return;
  state.fds = state.fds.filter(x => x.id !== id);
  state.entries = state.entries.filter(x => x.fdId !== id);
  saveState();
  renderSettings();
  toast(`Deleted ${f.code}`);
}

function submitSettings(ev) {
  ev.preventDefault();
  state.settings.depotRates.RAUNDS = num($('rateRAUNDS').value);
  state.settings.depotRates.GLENFIELD = num($('rateGLENFIELD').value);
  if ($('periodAnchor').value) state.settings.periodAnchor = $('periodAnchor').value;
  saveState();
  renderSettings();
  toast('Settings saved');
}

/* ---------- backup ---------- */

function download(content, name, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function downloadCsv(rows, name) {
  const cell = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  download('﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n'), name, 'text/csv;charset=utf-8');
}

function backup() {
  download(JSON.stringify(state, null, 2), `dpd-pnl-backup-${todayStr()}.json`, 'application/json');
}

function restore(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(reader.result);
      if (!s || !s.version || !Array.isArray(s.fds) || !Array.isArray(s.entries)) throw new Error('bad');
      if (!confirm(`Restore backup with ${s.fds.length} FDs and ${s.entries.length} entries? This replaces the data in this browser.`)) return;
      state = normalise(s);
      saveState();
      renderAll();
      toast('Backup restored');
    } catch (e) {
      alert('That file is not a valid DPD P&L backup.');
    }
  };
  reader.readAsText(file);
}

/* ============================================================
   WIRING
   ============================================================ */

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  try { localStorage.setItem(STORE_KEY + '-tab', name); } catch (e) { /* ignore */ }
  renderTab(name);
  window.scrollTo(0, 0);
}

function renderTab(name) {
  if (name === 'dashboard') renderDashboard();
  else if (name === 'daily') renderDaily();
  else if (name === 'entries') renderEntries();
  else if (name === 'settings') renderSettings();
}

function renderAll() {
  const active = document.querySelector('.tab.active');
  renderTab(active ? active.dataset.tab : 'dashboard');
}

function shiftDash(dir) {
  const step = ui.view === 'day' ? 1 : ui.view === 'week' ? 7 : 28;
  ui.date = fromDay(toDay(ui.date) + dir * step);
  renderDashboard();
}

function init() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
  document.addEventListener('click', ev => {
    const g = ev.target.closest('[data-goto]');
    if (g) { ev.preventDefault(); showTab(g.dataset.goto); }
  });

  // dashboard
  document.querySelectorAll('#viewSeg button').forEach(b => b.addEventListener('click', () => { ui.view = b.dataset.view; renderDashboard(); }));
  $('prevBtn').addEventListener('click', () => shiftDash(-1));
  $('nextBtn').addEventListener('click', () => shiftDash(1));
  $('todayBtn').addEventListener('click', () => { ui.date = todayStr(); renderDashboard(); });
  $('dashDate').addEventListener('change', e => { if (e.target.value) { ui.date = e.target.value; renderDashboard(); } });
  $('scopeSel').addEventListener('change', e => { ui.scope = e.target.value; renderDashboard(); });
  $('printBtn').addEventListener('click', () => window.print());
  $('exportReportBtn').addEventListener('click', exportReport);
  ['depotTable', 'fdTable'].forEach(id => $(id).addEventListener('click', ev => {
    const tr = ev.target.closest('tr[data-scope]'); if (!tr) return;
    ui.scope = tr.dataset.scope; renderDashboard();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  ['timeTable', 'timeTable2'].forEach(id => $(id).addEventListener('click', ev => {
    const tr = ev.target.closest('tr[data-day], tr[data-week]'); if (!tr) return;
    if (tr.dataset.day) { ui.view = 'day'; ui.date = tr.dataset.day; }
    else { ui.view = 'week'; ui.date = tr.dataset.week; }
    renderDashboard();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  // daily
  $('dayDate').addEventListener('change', e => { if (e.target.value) { ui.dayDate = e.target.value; renderDaily(); } });
  $('dayDepot').addEventListener('change', e => { ui.dayDepot = e.target.value; renderDaily(); });
  $('dayPrev').addEventListener('click', () => { ui.dayDate = fromDay(toDay(ui.dayDate) - 1); renderDaily(); });
  $('dayNext').addEventListener('click', () => { ui.dayDate = fromDay(toDay(ui.dayDate) + 1); renderDaily(); });
  $('dayCards').addEventListener('input', ev => {
    const card = ev.target.closest('.daycard'); if (!card) return;
    if (ev.target.name === 'routes' && num(ev.target.value) > 0) {
      const f = fdById(card.dataset.fd);
      const van = card.querySelector('[name="vanHire"]'), ins = card.querySelector('[name="insurance"]');
      if (f && van.value === '' && num(f.vanHire)) van.value = f.vanHire;
      if (f && ins.value === '' && num(f.insurance)) ins.value = f.insurance;
    }
    updateCardCalc(card);
    updateDayTotals();
  });
  $('saveDay').addEventListener('click', saveDay);

  // entries
  ['entFrom', 'entTo'].forEach(id => $(id).addEventListener('change', renderEntries));
  $('entScope').addEventListener('change', e => { entScope = e.target.value; renderEntries(); });
  $('entExport').addEventListener('click', exportEntries);
  $('entTable').addEventListener('click', ev => {
    const ed = ev.target.closest('[data-edit]');
    if (ed) { ui.dayDate = ed.dataset.edit; ui.dayDepot = 'ALL'; showTab('daily'); return; }
    const del = ev.target.closest('[data-del]');
    if (del && confirm('Delete this entry?')) {
      state.entries = state.entries.filter(x => x.id !== del.dataset.del);
      saveState(); renderEntries(); toast('Entry deleted');
    }
  });

  // settings
  $('fdForm').addEventListener('submit', submitFd);
  $('fdCancel').addEventListener('click', resetFdForm);
  $('fdList').addEventListener('click', ev => {
    const ed = ev.target.closest('[data-fdedit]'); if (ed) return editFd(ed.dataset.fdedit);
    const del = ev.target.closest('[data-fddel]'); if (del) return deleteFd(del.dataset.fddel);
  });
  $('settingsForm').addEventListener('submit', submitSettings);
  $('backupBtn').addEventListener('click', backup);
  $('restoreFile').addEventListener('change', e => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ''; });
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('Delete ALL FDs, entries and settings from this browser? Download a backup first if unsure.')) return;
    if (!confirm('Are you sure? This cannot be undone.')) return;
    state = defaultState(); saveState(); renderAll(); toast('All data deleted');
  });

  let startTab = state.fds.length ? 'dashboard' : 'settings';
  try { startTab = localStorage.getItem(STORE_KEY + '-tab') || startTab; } catch (e) { /* ignore */ }
  if (!state.fds.length) startTab = 'settings';
  showTab(startTab);
}

init();
