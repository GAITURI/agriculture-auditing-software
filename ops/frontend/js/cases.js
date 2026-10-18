import { initPage } from './navigation.js'
import { post } from './api.js'
import { can } from './auth.js'
import { $, badge, bindForm, esc, fmt, loadTable, modal, resetForm } from './components.js'
import { toast } from './notifications.js'

function main() {
  if (!initPage()) return
  let items = []
  const load = async page => {
    items = await loadTable({ tbody: $('#rows'), pager: $('#pager'), path: '/api/v1/reconciliation', page, onPage: load, colspan: 6, params: { status: $('#fStatus').value },
      empty: 'No cases here. Deliveries within the limit do not create one.',
      row: c => `<tr><td>${esc(c.delivery_reference)}</td><td>${fmt(c.expected)}</td><td>${fmt(c.actual)}</td>
        <td class="${c.variance < 0 ? 'text-danger fw-semibold' : ''}">${c.variance > 0 ? '+' : ''}${fmt(c.variance)} ${c.variance < 0 ? '(short)' : '(over)'}</td><td>${badge(c.status)}</td>
        <td>${c.status === 'resolved' ? esc(c.resolution_reason) : can('reconcile:resolve') ? `<button class="btn btn-sm btn-outline-primary" data-resolve="${c.id}">Resolve…</button>` : ''}</td></tr>` })
  }
  $('#fStatus').addEventListener('change', () => load(1))
  $('#rows').addEventListener('click', ev => {
    const b = ev.target.closest('[data-resolve]')
    if (!b) return
    const c = items.find(x => x.id === Number(b.dataset.resolve))
    resetForm($('#resolveForm')); $('#caseId').value = c.id; $('#caseVersion').value = c.version; modal('resolve').show()
  })
  bindForm($('#resolveForm'), async () => {
    await post(`/api/v1/reconciliation/${$('#caseId').value}/resolve`, { reason: $('#reason').value.trim(), version: Number($('#caseVersion').value) })
    modal('resolve').hide(); toast('ok', 'Case resolved. The original quantities are kept.'); load(1)
  })
  load(1)
}
main()
