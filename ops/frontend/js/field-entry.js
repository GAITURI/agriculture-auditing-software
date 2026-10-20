import { initPage } from './navigation.js'
import { get, post, request, getConfig } from './api.js'
import { can } from './auth.js'
import { $, addDays, badge, bindForm, esc, fillSelect, fmt, todayStr, uuid, ymd } from './components.js'
import { toast } from './notifications.js'

const n = v => (v === '' || v == null ? null : Number(v))

async function main() {
  if (!initPage()) return
  const cfg = await getConfig().catch(e => { toast('error', e.message); return null })
  if (!cfg) return
  const form = $('#entryForm'), q = k => form[k]
  fillSelect(q('block'), cfg.blocks)
  q('date').max = todayStr(); q('date').value = todayStr()  // any past date can be entered
  if (can('fruit:submit')) $('#saveSubmit').classList.remove('d-none')
  let key = uuid(), existing = [], submitAfter = false

  const update = () => {
    const h = n(q('harvested').value), c = n(q('collected').value), t = n(q('transported').value)
    const left = h != null && c != null ? h - c : null
    $('#leftVal').textContent = left == null ? '–' : left.toFixed(3)
    $('#leftTile').classList.toggle('bad', left != null && left < 0)
    $('#reasonGroup').classList.toggle('d-none', !(left > 0)); q('shortfall_reason').required = left > 0
    const dup = existing.find(r => r.block === q('block').value)
    const msgs = []
    const c1 = left < 0 ? 'Collected is more than harvested.' : ''; if (c1) msgs.push(c1)
    const c2 = t != null && c != null && t > c ? 'Transported is more than collected.' : ''; if (c2) msgs.push(c2)
    const c3 = dup ? `${q('block').value} already has a ${dup.status} record for this date. Edit it in Field records instead.` : ''; if (c3) msgs.push(c3)
    q('collected').setCustomValidity(c1); q('transported').setCustomValidity(c2); q('block').setCustomValidity(c3)
    $('#hint').textContent = msgs.join(' ')
  }
  const coverage = async () => {
    try { existing = (await get(`/api/v1/fruit-collection?start=${q('date').value}&end=${q('date').value}&page_size=50`)).items } catch { existing = [] }
    $('#coverage').innerHTML = cfg.blocks.map(b => { const r = existing.find(x => x.block === b); return `<li><span>${esc(b)}</span>${r ? badge(r.status) : '<span class="tagx t-open">missing</span>'}</li>` }).join('')
    update()
  }
  const recent = () => get(`/api/v1/fruit-collection?sort=-date&page_size=5&start=${ymd(addDays(new Date(), -365))}&end=${todayStr()}`).then(d => {
    $('#recent').innerHTML = d.items.length ? d.items.map(r => `<li><span>${esc(r.date)} · ${esc(r.block)}<br><span class="text-muted">${fmt(r.harvested)} t harvested</span></span>${badge(r.status)}</li>`).join('') : '<li class="text-muted">No records yet.</li>'
  }).catch(e => { $('#recent').innerHTML = `<li class="text-danger" role="alert">${esc(e.message)}</li>` })

  form.addEventListener('input', update)
  q('date').addEventListener('change', coverage)
  $('#saveSubmit').addEventListener('click', () => { submitAfter = true; form.requestSubmit() })
  bindForm(form, async () => {
    const wantSubmit = submitAfter; submitAfter = false
    const rec = await post('/api/v1/fruit-collection', { date: q('date').value, block: q('block').value, harvested: n(q('harvested').value), collected: n(q('collected').value), transported: n(q('transported').value),
      harvesters: n(q('harvesters').value), collectors: n(q('collectors').value), reason: q('shortfall_reason').value || null, remarks: q('remarks').value || null }, { key })
    key = uuid()
    if (wantSubmit) {
      try { await request(`/api/v1/fruit-collection/${rec.id}/submit`, { method: 'POST' }); toast('ok', 'Saved and submitted for approval.') }
      catch (e) { toast('warn', `Saved as a draft, but it could not be submitted: ${e.message}`) }
    } else toast('ok', 'Saved as a draft. Submit it from Field records when it is ready.')
    ;['harvested', 'collected', 'transported', 'harvesters', 'collectors', 'shortfall_reason', 'remarks'].forEach(k => { q(k).value = '' })
    form.classList.remove('was-validated')
    await Promise.all([coverage(), recent()])
  })
  await Promise.all([coverage(), recent()])
}
main()
