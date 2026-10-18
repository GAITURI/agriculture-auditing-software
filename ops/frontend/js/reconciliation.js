import { initPage } from './navigation.js'
import { get, getConfig } from './api.js'
import { $, downloadCsv, esc, fmt } from './components.js'
import { toast } from './notifications.js'

const MARK = { ok: '■', flag: '▲', missing: '○' }
async function main() {
  if (!initPage()) return
  const cfg = await getConfig().catch(e => { toast('error', e.message); return null })
  if (!cfg) return
  $('#start').value = cfg.cycle_start; $('#end').value = cfg.cycle_end
  let rows = []
  const load = async () => {
    $('#rows').innerHTML = '<tr><td colspan="8"><span class="skeleton"></span></td></tr>'
    try { rows = await get(`/api/v1/reports/reconciliation?start=${$('#start').value}&end=${$('#end').value}`) }
    catch (e) { $('#rows').innerHTML = `<tr><td colspan="8" class="text-danger" role="alert">${esc(e.message)}</td></tr>`; return }
    $('#strip').innerHTML = rows.map(r => `<div role="listitem" class="s-${esc(r.status)}" title="${esc(r.date)}: ${esc(r.status)}">${esc(r.date.slice(8))}<span class="visually-hidden"> ${esc(r.status)}</span></div>`).join('')
    $('#rows').innerHTML = rows.map(r => `<tr><td>${esc(r.date)}</td><td>${fmt(r.collected)}</td><td>${fmt(r.transported)}</td><td>${fmt(r.received)}</td><td>${fmt(r.difference)}</td>
      <td class="${r.status === 'flag' ? 'text-danger fw-semibold' : ''}">${fmt(r.window_diff)}</td><td class="${r.oer_alert ? 'text-danger fw-semibold' : ''}">${fmt(r.yield_pct)}</td><td>${MARK[r.status] || ''} ${esc(r.status)}</td></tr>`).join('')
  }
  $('#rangeForm').addEventListener('submit', e => { e.preventDefault(); load() })
  $('#exportCsv').addEventListener('click', () => rows.length ? downloadCsv('daily-reconciliation.csv', ['date', 'collected', 'transported', 'received', 'difference', 'window_diff', 'yield_pct', 'status'],
    rows.map(r => ['date', 'collected', 'transported', 'received', 'difference', 'window_diff', 'yield_pct', 'status'].map(k => r[k]))) : toast('info', 'Nothing to export yet.'))
  load()
}
main()
