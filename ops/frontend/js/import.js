import { initPage } from './navigation.js'
import { ApiError, request } from './api.js'
import { $, bindForm, confirmAction, esc, uuid } from './components.js'
import { toast } from './notifications.js'

function render(r) {
  const bad = r.errors.map(e => `<div class="alert alert-danger py-2 mb-2">${esc(e.sheet)}, row ${esc(e.row)}: ${esc(e.errors.join('; '))}</div>`).join('')
  const warn = (r.warnings || []).map(w => `<div class="alert alert-warning py-2 mb-2">Factory row ${esc(w.row)}: ${esc(w.messages.join('; '))}</div>`).join('')
  const clr = (r.cleared_cells || []).length ? `<div class="alert alert-warning py-2">Will clear values: ${esc(r.cleared_cells.map(c => `${c.sheet} row ${c.row} (${c.fields.join(', ')})`).join('; '))}</div>` : ''
  $('#report').innerHTML = `<div class="card card-body"><p class="mb-2"><strong>${r.inserts}</strong> new · <strong>${r.updates}</strong> updated · <strong>${r.errors.length}</strong> invalid row(s)${r.committed ? ' · <strong>imported</strong>' : ''}</p>${clr}${warn}${bad}</div>`
}

function main() {
  if (!initPage()) return
  let key = uuid()
  const file = () => $('#file').files[0]
  const send = commit => {
    const form = new FormData(); form.append('file', file())
    return request(`/api/v1/import?mode=${$('#mode').value}&commit=${commit}`, { method: 'POST', form, key: commit ? key : undefined, timeout: 60000 })
  }
  ;['#file', '#mode'].forEach(s => $(s).addEventListener('change', () => { $('#commit').disabled = true; $('#report').innerHTML = ''; key = uuid() }))
  bindForm($('#importForm'), async () => {
    const r = await send(false)
    render(r); $('#commit').disabled = r.errors.length > 0 || r.inserts + r.updates === 0
  })
  $('#commit').addEventListener('click', async () => {
    if ($('#mode').value === 'replace' && !(await confirmAction('"Clear existing values" removes stored values wherever the workbook cell is blank. Continue?', 'Import and clear'))) return
    $('#commit').disabled = true
    try { const r = await send(true); render(r); toast('ok', `Imported: ${r.inserts} new, ${r.updates} updated.`) }
    catch (e) { if (e instanceof ApiError && e.details?.errors) render(e.details); toast('error', e.message) }
  })
}
main()
