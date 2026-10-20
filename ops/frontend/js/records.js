import { initPage } from './navigation.js'
import { get, patch, post, request, getConfig } from './api.js'
import { can } from './auth.js'
import { $, addDays, badge, bindForm, confirmAction, esc, fillSelect, fmt, loadTable, modal, resetForm, todayStr, uuid, ymd } from './components.js'
import { toast } from './notifications.js'

const num = v => (v === '' || v == null ? null : Number(v))

async function main() {
  const user = initPage()
  if (!user) return
  const cfg = await getConfig().catch(e => { toast('error', e.message); return null })
  if (!cfg) return
  const tbody = $('#rows'), pager = $('#pager'), form = $('#recordForm')
  fillSelect($('#fBlock'), cfg.blocks, 'All'); fillSelect($('#block'), cfg.blocks)
  $('#date').max = todayStr()
  $('#fFrom').value = ymd(addDays(new Date(), -89)); $('#fTo').value = todayStr(); $('#fFrom').max = $('#fTo').max = todayStr()
  let items = [], key = uuid(), editing = null

  const load = async (page = 1) => {
    items = await loadTable({ tbody, pager, path: '/api/v1/fruit-collection', page, onPage: load, colspan: 8, empty: 'No records match. Use "New record" to add one.',
      params: { status: $('#fStatus').value, block: $('#fBlock').value, sort: $('#fSort').value, start: $('#fFrom').value, end: $('#fTo').value },
      row: r => `<tr><td>${esc(r.date)}</td><td>${esc(r.block)}</td><td>${fmt(r.harvested)}</td><td>${fmt(r.collected)}</td><td>${fmt(r.transported)}</td><td>${fmt(r.left_in_field)}</td><td>${badge(r.status)}</td><td class="text-nowrap">
        ${r.status === 'draft' && can('fruit:write') ? `<button class="btn btn-sm btn-outline-secondary" data-action="edit" data-id="${r.id}">Edit</button> ` : ''}
        ${r.status === 'draft' && can('fruit:submit') ? `<button class="btn btn-sm btn-outline-primary" data-action="submit" data-id="${r.id}">Submit</button>` : ''}
        ${r.status === 'submitted' && can('fruit:approve') ? (r.created_by === user.id ? '<span class="small text-muted">Needs a second approver</span>' : `<button class="btn btn-sm btn-primary" data-action="approve" data-id="${r.id}">Approve</button>`) : ''}</td></tr>` })
  }
  ;['#fStatus', '#fBlock', '#fSort', '#fFrom', '#fTo'].forEach(s => $(s).addEventListener('change', () => load(1)))

  const left = () => { const h = $('#harvested').value, c = $('#collected').value; $('#leftCalc').textContent = h === '' || c === '' ? '–' : (Number(h) - Number(c)).toFixed(3) }
  ;['#harvested', '#collected'].forEach(s => $(s).addEventListener('input', left))

  const open = rec => {
    editing = rec; resetForm(form); key = uuid()
    $('#recordTitle').textContent = rec ? 'Edit draft record' : 'New field record'
    $('#date').disabled = $('#block').disabled = !!rec
    $('#change_reason').closest('div').classList.toggle('d-none', !rec)
    if (rec) for (const k of ['date', 'block', 'harvested', 'collected', 'transported', 'harvesters', 'collectors', 'remarks']) form[k].value = rec[k] ?? ''
    if (rec) form.shortfall_reason.value = rec.reason ?? ''
    left(); modal('record').show()
  }
  if (can('fruit:write')) $('#newRecord').classList.remove('d-none')

  bindForm(form, async () => {
    const v = n => form[n].value
    const common = { harvested: num(v('harvested')), collected: num(v('collected')), transported: num(v('transported')), harvesters: num(v('harvesters')), collectors: num(v('collectors')), remarks: v('remarks') || null }
    if (editing) await patch(`/api/v1/fruit-collection/${editing.id}`, { ...common, version: editing.version, shortfall_reason: v('shortfall_reason') || null, reason: v('change_reason') || null })
    else await post('/api/v1/fruit-collection', { ...common, date: v('date'), block: v('block'), reason: v('shortfall_reason') || null }, { key })
    modal('record').hide(); toast('ok', editing ? 'Draft updated.' : 'Saved as a draft. Submit it when it is ready for approval.'); load(1)
  })

  tbody.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-action]')
    if (!b) return
    const id = Number(b.dataset.id), rec = items.find(r => r.id === id)
    if (b.dataset.action === 'edit') return open(rec)
    const verb = b.dataset.action
    if (verb === 'approve' && !(await confirmAction(`Approve the ${rec.block} record for ${rec.date}? Approved records can no longer be edited.`, 'Approve'))) return
    try { await request(`/api/v1/fruit-collection/${id}/${verb}`, { method: 'POST' }); toast('ok', verb === 'submit' ? 'Submitted for approval.' : 'Record approved.'); load(1) }
    catch (e) { toast('error', e.message) }
  })
  load(1)
}
main()
