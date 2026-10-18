import { initPage } from './navigation.js'
import { get, post, getConfig } from './api.js'
import { can } from './auth.js'
import { $, badge, bindForm, esc, fillSelect, fmt, isoLocal, loadTable, modal, resetForm, uuid } from './components.js'
import { toast } from './notifications.js'

async function main() {
  if (!initPage()) return
  const cfg = await getConfig().catch(e => { toast('error', e.message); return null })
  if (!cfg) return
  fillSelect($('#block'), cfg.blocks)
  let key = uuid()
  const load = page => loadTable({ tbody: $('#rows'), pager: $('#pager'), path: '/api/v1/deliveries', page, onPage: load, colspan: 7, empty: 'No deliveries yet.',
    row: d => `<tr><td>${esc(d.reference)}</td><td>${esc(d.block)}</td><td>${esc(new Date(d.dispatched_at).toLocaleString())}</td><td>${fmt(d.dispatched_qty)}</td><td>${badge(d.status)}</td><td>${fmt(d.received_qty)}</td>
      <td>${d.status === 'in_transit' && can('delivery:receive') ? `<button class="btn btn-sm btn-outline-primary" data-receive="${d.id}">Record receipt</button>` : ''}</td></tr>` })
  if (can('delivery:dispatch')) {
    $('#newDispatch').classList.remove('d-none')
    $('#newDispatch').addEventListener('click', () => { resetForm($('#dispatchForm')); key = uuid(); modal('dispatch').show() })
  }
  bindForm($('#dispatchForm'), async () => {
    const f = $('#dispatchForm')
    await post('/api/v1/deliveries', { reference: f.reference.value.trim(), block: f.block.value, vehicle: f.vehicle.value || null, dispatched_at: isoLocal(f.dispatched_at.value), dispatched_qty: Number(f.dispatched_qty.value) }, { key })
    modal('dispatch').hide(); toast('ok', 'Dispatch recorded.'); load(1)
  })
  $('#rows').addEventListener('click', ev => {
    const b = ev.target.closest('[data-receive]')
    if (!b) return
    resetForm($('#receiptForm')); $('#deliveryId').value = b.dataset.receive; key = uuid(); modal('receipt').show()
  })
  bindForm($('#receiptForm'), async () => {
    const f = $('#receiptForm')
    const out = await post(`/api/v1/deliveries/${f.deliveryId.value}/receipt`, { received_at: isoLocal(f.received_at.value), received_qty: Number(f.received_qty.value), weighbridge_ref: f.weighbridge_ref.value || null }, { key })
    modal('receipt').hide()
    out.case_id ? toast('warn', `Received with a variance of ${fmt(out.variance)} t. A reconciliation case was opened.`) : toast('ok', 'Receipt recorded. Quantities match.')
    load(1)
  })
  load(1)
}
main()
