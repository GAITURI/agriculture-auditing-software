import { initPage } from './navigation.js'
import { get, getConfig } from './api.js'
import { can } from './auth.js'
import { $, badge, esc, fmt, icon, pct, presetRange, relTime, todayStr } from './components.js'
import { toast } from './notifications.js'

const SERIES = [{ key: 'collected', label: 'Collected', color: 'var(--link)', dash: '' }, { key: 'transported', label: 'Transported', color: 'var(--accent)', dash: '7 4' }, { key: 'received', label: 'Received', color: 'var(--bad-ink)', dash: '2 4' }]
const dLabel = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

function chip(cur, prev, goodWhenUp = true) {
  const p = pct(cur, prev)
  if (p === null) return ''
  const up = p >= 0
  return `<span class="chip ${up ? 'up' : 'down'}-${up === goodWhenUp ? 'good' : 'bad'}" title="Compared with the previous period">${up ? '▲ +' : '▼ '}${p.toFixed(1)}%</span>`
}

function spark(vals) {
  const pts = vals.map((v, i) => (v == null ? null : [i, v])).filter(Boolean)
  if (pts.length < 2) return '<div class="spark"></div>'
  const W = 200, H = 38, max = Math.max(...pts.map(p => p[1])), min = Math.min(...pts.map(p => p[1])), span = max - min || 1
  const x = i => i / (vals.length - 1) * W, y = v => H - 4 - (v - min) / span * (H - 10)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')
  return `<svg class="spark" style="color:var(--link)" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}L${x(pts.at(-1)[0]).toFixed(1)},${H}L${x(pts[0][0]).toFixed(1)},${H}Z" fill="currentColor" opacity=".13"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`
}

function lineChart(el, rows, freq) {
  const vals = rows.flatMap(r => SERIES.map(s => r[s.key])).filter(v => v != null)
  if (!vals.length) { el.innerHTML = '<p class="text-muted text-center py-5 mb-0">No tonnage recorded in this period.</p>'; return }
  const W = 760, H = 270, P = { l: 46, r: 14, t: 12, b: 30 }, max = Math.max(...vals) || 1
  const x = i => P.l + (rows.length < 2 ? (W - P.l - P.r) / 2 : i * (W - P.l - P.r) / (rows.length - 1)), y = v => H - P.b - v / max * (H - P.t - P.b)
  const grid = [0, .25, .5, .75, 1].map(f => `<line class="gl" x1="${P.l}" x2="${W - P.r}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${P.l - 8}" y="${y(max * f) + 4}" text-anchor="end" font-size="11">${fmt(Math.round(max * f * 10) / 10)}</text>`).join('')
  const lines = SERIES.map(s => {
    const pts = rows.map((r, i) => (r[s.key] == null ? null : [x(i), y(r[s.key])]))
    const path = pts.reduce((a, p, i) => (p ? a + `${pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : a), '')
    if (!path) return ''
    const area = s.key === 'collected' ? `<path d="${path}L${pts.filter(Boolean).at(-1)[0].toFixed(1)},${y(0)}L${pts.find(Boolean)[0].toFixed(1)},${y(0)}Z" style="fill:${s.color}" opacity=".10"/>` : ''
    const dots = rows.length <= 16 ? pts.map(p => (p ? `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" style="fill:${s.color}"/>` : '')).join('') : ''
    return `${area}<path d="${path}" fill="none" style="stroke:${s.color}" stroke-width="2.4" stroke-dasharray="${s.dash}" stroke-linejoin="round" stroke-linecap="round"/>${dots}`
  }).join('')
  const step = Math.ceil(rows.length / 9)
  const ticks = rows.map((r, i) => (i % step === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11">${esc(freq === 'M' ? r.date.slice(0, 7) : r.date.slice(5))}</text>` : '')).join('')
  const legend = SERIES.map(s => `<span><svg width="26" height="8" aria-hidden="true"><line x1="0" x2="26" y1="4" y2="4" style="stroke:${s.color}" stroke-width="2.4" stroke-dasharray="${s.dash}"/></svg> ${s.label}</span>`).join('')
  el.innerHTML = `<div class="chart-wrap"><svg class="chart" style="width:100%;height:auto" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tonnage collected, transported and received, grouped ${{ D: 'daily', W: 'weekly', M: 'monthly' }[freq]}">${grid}${lines}${ticks}</svg></div><div class="legend mt-2">${legend}${rows.at(-1).date > todayStr() && freq !== 'D' ? '<span class="ms-auto">The latest bar is still in progress</span>' : ''}</div>`
}

const DESCRIBE = a => {
  const L = a.label ? `<span class="ref">${esc(a.label)}</span>` : '', w = `<strong>${esc(a.actor)}</strong>`
  const map = {
    'fruit_collection:create': ['entry', '', `${w} recorded a field entry for ${L}`], 'fruit_collection:update': ['entry', '', `${w} edited the field record ${L}`],
    'fruit_collection:import_update': ['upload', '', `${w} updated ${L} through an import`], 'fruit_collection:submit': ['records', 'warn', `${w} submitted ${L} for approval`],
    'fruit_collection:approve': ['check', 'ok', `${w} approved ${L}`], 'factory_production:create': ['factory', '', `${w} saved factory production for ${L}`],
    'factory_production:update': ['factory', '', `${w} updated factory production for ${L}`], 'delivery:dispatch': ['truck', '', `${w} dispatched ${L}`],
    'delivery:receive': ['check', 'ok', `${w} recorded the factory receipt for ${L}`], 'reconciliation_case:open': ['alert', 'bad', `A reconciliation case was opened for ${L}`],
    'reconciliation_case:resolve': ['check', 'ok', `${w} resolved the case for ${L}`], 'import:commit': ['upload', '', `${w} imported a workbook (${esc(a.after?.rows ?? '?')} rows)`] }
  return map[`${a.entity}:${a.action}`] || ['records', '', `${w} ${esc(a.action)} ${esc(a.entity.replace('_', ' '))}`]
}

function timeline(items) {
  const dayName = iso => { const d = new Date(iso), t = new Date(); const same = (a, b) => a.toDateString() === b.toDateString(); const y = new Date(t); y.setDate(t.getDate() - 1)
    return same(d, t) ? 'Today' : same(d, y) ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) }
  let last = '', html = ''
  for (const a of items) {
    const day = dayName(a.at)
    if (day !== last) { html += `${last ? '</ul>' : ''}<div class="day-label">${esc(day)}</div><ul class="tl">`; last = day }
    const [ic, tone, text] = DESCRIBE(a)
    html += `<li><span class="ico ${tone}">${icon(ic, 16)}</span><div class="min-w-0"><div>${text}</div>${a.reason && !a.reason.startsWith('import ') ? `<div class="why">“${esc(a.reason)}”</div>` : ''}<div class="when">${esc(relTime(a.at))}</div></div></li>`
  }
  return html + '</ul>'
}

async function main() {
  const user = initPage()
  if (!user) return
  const cfg = await getConfig().catch(() => null)
  const hr = new Date().getHours(), name = user.full_name || user.email.split('@')[0]
  $('#hello').textContent = `${hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}, ${name}`
  const st = { p: localStorage.getItem('scipec.period') || '90d', start: '', end: '', freq: null, tab: 'transit', transit: null, cases: null }
  $('#start').max = $('#end').max = todayStr()
  const days = () => Math.round((new Date($('#end').value || st.end) - new Date($('#start').value || st.start)) / 864e5) + 1
  const autoFreq = () => { const n = Math.round((new Date(st.end) - new Date(st.start)) / 864e5) + 1; return n <= 45 ? 'D' : n <= 200 ? 'W' : 'M' }
  const mark = (sel, attr, val) => document.querySelectorAll(`${sel} button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === val)))

  const loadLists = async () => {
    const jobs = []
    if (can('delivery:read')) jobs.push(get('/api/v1/deliveries?status=in_transit&page_size=5').then(d => { st.transit = d }).catch(e => { st.transit = { error: e.message } }))
    if (can('reconcile:read')) jobs.push(get('/api/v1/reconciliation?status=open&page_size=5').then(d => { st.cases = d }).catch(e => { st.cases = { error: e.message } }))
    await Promise.all(jobs); renderDeliv()
    if (can('audit:read')) get('/api/v1/audit?page_size=8').then(d => { $('#activity').innerHTML = d.items.length ? timeline(d.items) : '<p class="text-muted mb-0">Activity appears here as your team records data.</p>' })
      .catch(e => { $('#activity').innerHTML = `<p class="text-danger mb-0" role="alert">${esc(e.message)}</p>` })
    else {
      $('#actTitle').textContent = 'Quick links'
      const L = [['field-entry.html', 'Record today’s collection', 'fruit:write'], ['factory-entry.html', 'Record factory production', 'factory:write'], ['deliveries.html', 'Dispatches and receipts', 'delivery:read'], ['import.html', 'Import a workbook', 'import:write']].filter(([, , p]) => can(p))
      $('#activity').innerHTML = L.map(([h, t]) => `<div class="list-row"><a href="${h}">${esc(t)}</a></div>`).join('') || '<p class="text-muted mb-0">Use the menu to open a page.</p>'
    }
  }
  function renderDeliv() {
    const tabs = document.querySelectorAll('#tabs button'), t = st.tab, d = st[t === 'transit' ? 'transit' : 'cases']
    tabs[0].textContent = `In transit${st.transit?.total != null ? ` (${st.transit.total})` : ''}`; tabs[1].textContent = `Open cases${st.cases?.total != null ? ` (${st.cases.total})` : ''}`
    $('#delivAll').href = t === 'transit' ? 'deliveries.html' : 'cases.html'; $('#delivAll').textContent = t === 'transit' ? 'View all deliveries' : 'View all cases'
    const el = $('#deliv')
    if (!d) { el.innerHTML = '<p class="text-muted mb-0">Your role cannot view this list.</p>'; return }
    if (d.error) { el.innerHTML = `<p class="text-danger mb-0" role="alert">${esc(d.error)}</p>`; return }
    if (!d.items.length) { el.innerHTML = `<p class="text-muted py-3 mb-0">${t === 'transit' ? 'Nothing in transit. Dispatches appear here until the factory records a receipt.' : 'No open cases. Every delivery is within the variance limit.'}</p>`; return }
    el.innerHTML = t === 'transit'
      ? d.items.map(x => `<div class="list-row"><div class="min-w-0"><div class="fw-bold">${esc(x.reference)}</div><div class="small text-muted">${esc(x.block)} · dispatched ${esc(relTime(x.dispatched_at))}</div></div><div class="fw-bold text-nowrap">${fmt(x.dispatched_qty)} t</div></div>`).join('')
      : d.items.map(c => `<div class="list-row"><div class="min-w-0"><div class="fw-bold">${esc(c.delivery_reference)}</div><div class="small text-muted">Dispatched ${fmt(c.expected)} t · received ${fmt(c.actual)} t</div></div><span class="chip ${c.variance < 0 ? 'down-bad' : 'up-bad'}">${c.variance > 0 ? '+' : ''}${fmt(c.variance)} t</span></div>`).join('')
  }

  const loadAll = async () => {
    const q = `start=${st.start}&end=${st.end}`, freq = st.freq || autoFreq()
    mark('#freq', 'f', freq)
    $('#kpis').innerHTML = Array.from({ length: 4 }, () => '<div class="card kpi-card"><span class="skeleton"></span><span class="skeleton" style="width:40%"></span></div>').join('')
    $('#emptyState').classList.add('d-none'); $('#data').classList.remove('d-none')
    try {
      const [s, series, blocks] = await Promise.all([get(`/api/v1/dashboard/summary?${q}&compare=true`), get(`/api/v1/dashboard/timeseries?${q}&freq=${freq}`), get(`/api/v1/dashboard/blocks?${q}`)])
      const p = s.previous, [ps, pe] = s.previous_range
      $('#periodNote').textContent = `${dLabel(st.start)} – ${dLabel(st.end)} · compared with ${dLabel(ps)} – ${dLabel(pe)} · drafts are not counted`
      const has = ['harvested', 'collected', 'transported', 'received', 'processed', 'oil'].some(k => s[k] != null)
      const links = [[s.flagged_days, 'day(s) where transported and received differ by more than the limit', 'reconciliation.html'], [has ? s.missing_days : 0, 'day(s) with no record', 'reconciliation.html'],
        [s.oer_alerts, 'day(s) with oil extraction outside the normal range', 'reconciliation.html'], [s.open_cases, 'open reconciliation case(s)', 'cases.html']].filter(([n]) => n > 0)
      $('#attention').innerHTML = links.length ? `<div class="alert alert-warning d-flex flex-wrap align-items-center gap-x-4 gap-2" role="status"><strong>Needs attention</strong>${links.map(([n, t, h]) => `<a href="${h}" class="text-reset fw-semibold">${n} ${esc(t)}</a>`).join('<span aria-hidden="true">·</span>')}</div>` : ''
      if (!has) {
        $('#data').classList.add('d-none'); const es = $('#emptyState'); es.classList.remove('d-none')
        es.innerHTML = `<div class="ico">${icon('records', 26)}</div><h2 class="fs-5 fw-bold">No records in this period</h2><p class="text-muted mx-auto" style="max-width:30rem">Nothing has been submitted between ${esc(dLabel(st.start))} and ${esc(dLabel(st.end))}. Try a longer period, or record data to see it here.</p>
          <div class="d-flex gap-2 justify-content-center flex-wrap"><button class="btn btn-outline-primary" id="goYear" type="button">Show this year</button>${can('fruit:write') ? `<a class="btn btn-primary" href="field-entry.html">Record collection</a>` : ''}</div>`
        $('#goYear').addEventListener('click', () => setPeriod('year')); return
      }
      const kp = [['truck', 'Collected', s.collected, 't', chip(s.collected, p.collected), series.map(r => r.collected), `of ${fmt(s.harvested)} t harvested`],
        ['scale', 'Received at factory', s.received, 't', chip(s.received, p.received), series.map(r => r.received), `${fmt(s.transported)} t transported`],
        ['oil', 'Oil extraction rate', s.yield_pct == null ? null : Number(s.yield_pct.toFixed(1)), '%', chip(s.yield_pct, p.yield_pct), series.map(r => r.yield_pct), `${fmt(s.oil)} t oil from ${fmt(s.processed)} t`],
        ['alert', 'Open delivery cases', s.open_cases, '', '', null, s.open_cases ? '<a href="cases.html">Review cases →</a>' : 'All within the limit']]
      $('#kpis').innerHTML = kp.map(([ic, l, v, u, c, sp, foot]) => `<div class="card kpi-card"><div class="kpi-label"><span class="d-flex align-items-center gap-2">${icon(ic, 16)}${esc(l)}</span>${c}</div>
        <div class="kpi-value">${fmt(v)}${u ? `<span class="unit">${esc(u)}</span>` : ''}</div>${sp ? spark(sp) : ''}<div class="kpi-foot"><span>${foot}</span></div></div>`).join('')
      lineChart($('#chart'), series, freq)
      const tot = Math.max(1, ...blocks.map(b => (b.collected || 0) + (b.left_in_field || 0)))
      $('#blocks').innerHTML = blocks.map(b => b.collected == null && b.harvested == null ? `<div class="bar-row"><div class="bar-top"><strong>${esc(b.block)}</strong><span class="text-muted">No records</span></div><div class="bar"></div></div>`
        : `<div class="bar-row"><div class="bar-top"><strong>${esc(b.block)}</strong><span>${fmt(b.collected)} t</span></div><div class="bar" role="img" aria-label="${esc(b.block)}: ${fmt(b.collected)} t collected, ${fmt(b.left_in_field)} t left in field"><i style="width:${(b.collected || 0) / tot * 100}%;background:var(--link)"></i><i style="width:${(b.left_in_field || 0) / tot * 100}%;background:var(--accent)"></i></div>
        <div class="small text-muted mt-1">${b.left_in_field ? `${fmt(b.left_in_field)} t left in field` : 'Nothing left in field'}</div></div>`).join('') + '<div class="legend mt-3"><span><i class="dot" style="background:var(--link)"></i>Collected</span><span><i class="dot" style="background:var(--accent)"></i>Left in field</span></div>'
      const F = [['Harvested', s.harvested, 't'], ['Collected', s.collected, 't'], ['Transported', s.transported, 't'], ['Left in field', s.left_in_field, 't'], ['Received at factory', s.received, 't'], ['Processed', s.processed, 't'], ['Palm oil produced', s.oil, 't'], ['Factory downtime', s.downtime, 'h']]
      $('#figures').innerHTML = F.map(([l, v, u]) => `<div><span class="text-muted">${esc(l)}</span><strong>${fmt(v)} ${u}</strong></div>`).join('')
    } catch (e) { $('#kpis').innerHTML = `<div class="alert alert-danger" role="alert" style="grid-column:1/-1">${esc(e.message)} <button class="btn btn-sm btn-outline-secondary ms-2" id="retry" type="button">Retry</button></div>`; $('#retry').addEventListener('click', loadAll) }
  }

  function setPeriod(p, range) {
    st.p = p; st.freq = null
    const r = range || presetRange(p)
    if (p === 'custom' && !range) { $('#customForm').classList.remove('d-none'); $('#customForm').classList.add('d-flex'); mark('#periods', 'p', 'custom'); return }
    if (p !== 'custom') { $('#customForm').classList.add('d-none'); $('#customForm').classList.remove('d-flex'); localStorage.setItem('scipec.period', p) }
    ;[st.start, st.end] = r; $('#start').value = st.start; $('#end').value = st.end
    mark('#periods', 'p', p); loadAll()
  }
  $('#periods').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setPeriod(b.dataset.p) })
  $('#customForm').addEventListener('submit', e => { e.preventDefault(); if ($('#start').value > $('#end').value) return toast('error', 'The start date must be before the end date.'); if (days() > 731) return toast('error', 'Choose a period of two years or less.'); setPeriod('custom', [$('#start').value, $('#end').value]) })
  $('#freq').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { st.freq = b.dataset.f; loadAll() } })
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { st.tab = b.dataset.t; mark('#tabs', 't', st.tab); renderDeliv() } })
  setPeriod(st.p === 'custom' ? '90d' : st.p)
  loadLists()
}
main()
