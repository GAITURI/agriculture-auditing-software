import { initPage } from './navigation.js'
import { get, getConfig } from './api.js'
import { can } from './auth.js'
import { $, badge, esc, fmt, icon, pct } from './components.js'
import { toast } from './notifications.js'

const SERIES = [{ key: 'collected', label: 'Collected', color: '#2f7d4f', dash: '', area: true }, { key: 'transported', label: 'Transported', color: '#d08a00', dash: '6 3' }, { key: 'received', label: 'Received', color: '#c0392b', dash: '2 3' }]

function chip(cur, prev, goodWhenUp = true) {
  const p = pct(cur, prev)
  if (p === null) return ''
  const up = p >= 0
  return `<span class="chip ${up ? 'up' : 'down'}-${up === goodWhenUp ? 'good' : 'bad'}" title="Compared with the previous period">${up ? '▲ +' : '▼ '}${p.toFixed(1)}%</span>`
}

function lineChart(el, rows, freq) {
  const vals = rows.flatMap(r => SERIES.map(s => r[s.key])).filter(v => v != null)
  if (!vals.length) { el.innerHTML = '<p class="text-muted mb-0 py-4 text-center">No submitted records in this period yet. Draft records are not counted.</p>'; return }
  const W = 760, H = 280, P = { l: 48, r: 14, t: 14, b: 30 }, max = Math.max(...vals) || 1
  const x = i => P.l + (rows.length < 2 ? (W - P.l - P.r) / 2 : i * (W - P.l - P.r) / (rows.length - 1)), y = v => H - P.b - v / max * (H - P.t - P.b)
  const grid = [0, .25, .5, .75, 1].map(f => `<line class="gl" x1="${P.l}" x2="${W - P.r}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${P.l - 8}" y="${y(max * f) + 4}" text-anchor="end" font-size="11">${fmt(Math.round(max * f * 10) / 10)}</text>`).join('')
  const lines = SERIES.map(s => {
    const pts = rows.map((r, i) => (r[s.key] == null ? null : [x(i), y(r[s.key])]))
    const path = pts.reduce((a, p, i) => (p ? a + `${pts[i - 1] ? 'L' : 'M'}${p[0]},${p[1]}` : a), '')
    if (!path) return ''
    const area = s.area ? `<path d="${path}L${pts.filter(Boolean).at(-1)[0]},${y(0)}L${pts.find(Boolean)[0]},${y(0)}Z" fill="${s.color}" opacity=".10"/>` : ''
    const dots = rows.length <= 14 ? pts.map(p => (p ? `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${s.color}"/>` : '')).join('') : ''
    return `${area}<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-dasharray="${s.dash}" stroke-linejoin="round"/>${dots}`
  }).join('')
  const step = Math.ceil(rows.length / 9)
  const ticks = rows.map((r, i) => (i % step === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11">${esc(freq === 'M' ? r.date.slice(0, 7) : r.date.slice(5))}</text>` : '')).join('')
  const legend = SERIES.map(s => `<span class="me-3"><svg width="26" height="8" aria-hidden="true"><line x1="0" x2="26" y1="4" y2="4" stroke="${s.color}" stroke-width="2.2" stroke-dasharray="${s.dash}"/></svg> ${s.label}</span>`).join('')
  el.innerHTML = `<svg class="chart tw-w-full" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tonnage collected, transported and received, grouped ${freq === 'D' ? 'daily' : freq === 'W' ? 'weekly' : 'monthly'}">${grid}${lines}${ticks}</svg><div class="small mt-2">${legend}</div>`
}

async function main() {
  const user = initPage()
  if (!user) return
  const cfg = await getConfig().catch(e => { toast('error', e.message); return null })
  if (!cfg) return
  $('#greet').textContent = `Hi ${user.full_name || user.email.split('@')[0]}`
  $('#start').value = cfg.cycle_start; $('#end').value = cfg.cycle_end
  const freq = () => document.querySelector('input[name=freq]:checked').value
  const range = () => `start=${$('#start').value}&end=${$('#end').value}`

  const loadSeries = async () => {
    $('#chart').innerHTML = '<div class="py-5 text-center"><span class="skeleton"></span></div>'
    try { lineChart($('#chart'), await get(`/api/v1/dashboard/timeseries?${range()}&freq=${freq()}`), freq()) }
    catch (e) { $('#chart').innerHTML = `<div class="alert alert-danger mb-0" role="alert">${esc(e.message)}</div>` }
  }

  const loadSide = () => {
    if (can('delivery:read')) get('/api/v1/deliveries?status=in_transit&page_size=5').then(d => {
      $('#transit').innerHTML = d.items.length ? d.items.map(x => `<li class="d-flex justify-content-between gap-2 py-2 border-bottom"><div class="min-w-0"><strong>${esc(x.reference)}</strong><div class="small text-muted text-truncate">${esc(x.block)} · ${esc(new Date(x.dispatched_at).toLocaleString())}</div></div><div class="text-end text-nowrap">${fmt(x.dispatched_qty)} t</div></li>`).join('')
        : '<li class="text-muted py-3">Nothing in transit. Dispatches appear here until the factory records a receipt.</li>'
    }).catch(e => { $('#transit').innerHTML = `<li class="text-danger" role="alert">${esc(e.message)}</li>` })
    else $('#transit').innerHTML = '<li class="text-muted">Your role cannot view deliveries.</li>'
    if (can('reconcile:read')) get('/api/v1/reconciliation?status=open&page_size=4').then(d => {
      $('#cases').innerHTML = d.items.length ? d.items.map(c => `<li class="d-flex justify-content-between align-items-center gap-2 py-2 border-bottom"><div><strong>${esc(c.delivery_reference)}</strong><div class="small text-muted">Dispatched ${fmt(c.expected)} t · received ${fmt(c.actual)} t</div></div><div class="text-end"><span class="text-danger fw-semibold">${c.variance > 0 ? '+' : ''}${fmt(c.variance)} t</span> ${badge(c.status)}</div></li>`).join('') + (d.total > 4 ? `<li class="small text-muted pt-2">${d.total - 4} more open</li>` : '')
        : '<li class="text-muted py-3">No open cases. Every delivery is within the variance limit.</li>'
    }).catch(e => { $('#cases').innerHTML = `<li class="text-danger" role="alert">${esc(e.message)}</li>` })
    else $('#cases').innerHTML = '<li class="text-muted">Your role cannot view reconciliation cases.</li>'
    if (can('audit:read')) get('/api/v1/audit?page_size=6').then(d => {
      $('#activityList').innerHTML = d.items.length ? d.items.map(a => `<li class="py-1 border-bottom">${esc(new Date(a.at).toLocaleString())} · <strong>${esc(a.action)}</strong> ${esc(a.entity.replace('_', ' '))} #${esc(a.entity_id)}${a.reason ? ` · ${esc(a.reason)}` : ''}</li>`).join('') : '<li class="text-muted">No activity yet.</li>'
    }).catch(() => {})
    else {
      $('#sideTitle').textContent = 'Quick links'
      const L = [['field-entry.html', 'Record today’s collection', 'fruit:write'], ['factory-entry.html', 'Record factory production', 'factory:write'], ['deliveries.html', 'Dispatches and receipts', 'delivery:read'], ['import.html', 'Import a workbook', 'import:write']].filter(([, , p]) => can(p))
      $('#activityList').innerHTML = L.map(([h, t]) => `<li class="py-2 border-bottom"><a href="${h}">${esc(t)}</a></li>`).join('') || '<li class="text-muted">Use the menu to open a page.</li>'
    }
  }

  const loadSummary = async () => {
    $('#kpis').innerHTML = Array.from({ length: 4 }, () => '<div class="col-sm-6 col-xl-3"><div class="card"><div class="card-body"><span class="skeleton"></span></div></div></div>').join('')
    try {
      const s = await get(`/api/v1/dashboard/summary?${range()}&compare=true`)  // current + previous period in one request
      const p = s.previous, [ps, pe] = s.previous_range
      const main4 = [['truck', 'FFB collected', s.collected, 't', chip(s.collected, p.collected)], ['scale', 'Received at factory', s.received, 't', chip(s.received, p.received)],
        ['oil', 'Oil extraction rate', s.yield_pct, '%', chip(s.yield_pct, p.yield_pct)], ['alert', 'Open delivery cases', s.open_cases, '', '']]
      $('#kpis').innerHTML = main4.map(([ic, l, v, u, c]) => `<div class="col-sm-6 col-xl-3"><div class="card h-100 kpi"><div class="card-body d-flex align-items-center gap-3"><span class="kpi-icon">${icon(ic, 22)}</span>
        <div class="flex-grow-1 min-w-0"><div class="value">${fmt(v)}<span class="unit"> ${esc(u)}</span></div><div class="small text-muted">${esc(l)}</div></div>${c}</div></div></div>`).join('')
      const tiles = [['FFB harvested', s.harvested, 't', chip(s.harvested, p.harvested)], ['FFB transported', s.transported, 't', chip(s.transported, p.transported)], ['Left in field', s.left_in_field, 't', chip(s.left_in_field, p.left_in_field, false)],
        ['FFB processed', s.processed, 't', chip(s.processed, p.processed)], ['Palm oil produced', s.oil, 't', chip(s.oil, p.oil)], ['Factory downtime', s.downtime, 'h', chip(s.downtime, p.downtime, false)]]
      $('#tiles').innerHTML = tiles.map(([l, v, u, c]) => `<div class="col-6 col-md-4 col-xl-2"><div class="stat-tile h-100"><div class="small text-muted">${esc(l)}</div><div class="v">${fmt(v)} <span class="small fw-normal text-muted">${esc(u)}</span></div>${c}</div></div>`).join('')
      const notes = [[s.flagged_days, 'day(s) outside the variance limit'], [s.missing_days, 'day(s) with missing records'], [s.oer_alerts, 'extraction-rate alert(s)']].filter(([n]) => n > 0)
      $('#alerts').innerHTML = notes.length ? `<div class="alert alert-warning" role="status"><strong>Needs attention:</strong> ${notes.map(([n, t]) => `${n} ${esc(t)}`).join(' · ')}</div>` : ''
      $('#sub').textContent = `${s.start} to ${s.end} · compared with ${ps} to ${pe} · drafts are not counted · updated ${new Date(s.generated_at).toLocaleTimeString()}`
    } catch (e) { $('#kpis').innerHTML = `<div class="col-12"><div class="alert alert-danger" role="alert">${esc(e.message)} <button class="btn btn-sm btn-outline-secondary ms-2" id="retry" type="button">Retry</button></div></div>`; $('#retry').addEventListener('click', loadAll) }
  }
  const loadAll = () => { loadSummary(); loadSeries(); loadSide() }
  $('#rangeForm').addEventListener('submit', e => { e.preventDefault(); loadAll() })
  document.querySelectorAll('input[name=freq]').forEach(r => r.addEventListener('change', loadSeries))
  loadAll()
}
main()
