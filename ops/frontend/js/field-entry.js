// Field entry. Self-contained on purpose: it needs only helpers that have existed since the first release
// (components: $, badge, bindForm, esc, fmt, uuid; api: get, post, request) and does not read any reporting-period limit.
import { initPage } from './navigation.js'
import { get, post, request } from './api.js'
import { can } from './auth.js'
import { $, badge, bindForm, esc, fmt, uuid } from './components.js'
import { toast } from './notifications.js'

const p2 = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d) }
const nice = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const short = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const num = v => (v === '' || v == null ? null : Number(v))

async function main() {
  if (!initPage()) return
  const blocks = await get('/api/v1/blocks').catch(e => { toast('error', e.message); return null })
  if (!blocks) return
  const form = $('#entryForm'), q = k => form.elements[k]
  const today = ymd(new Date())
  q('date').max = today; q('date').value = today  // any past date can be entered: there is no minimum
  if (can('fruit:submit')) $('#saveSubmit').classList.remove('d-none')
  let existing = [], key = uuid(), submitAfter = false, dirty = false

  // inline message under a field + browser validity (so Save is blocked until it is fixed)
  const err = (el, msg) => {
    el.setCustomValidity(msg || ''); el.classList.toggle('is-invalid', !!msg)
    const fb = el.closest('[class*=col-]').querySelector('.fb'); if (fb) { fb.textContent = msg || ''; fb.classList.toggle('d-none', !msg) }
  }
  const chosen = () => form.elements.block.value || ''
  const free = () => blocks.filter(b => !existing.some(r => r.block === b))
  const pick = (name, focus) => {
    document.querySelectorAll('#blocks .blk').forEach(l => { const i = l.querySelector('input'); i.checked = i.value === name; l.classList.toggle('on', i.checked) })
    $('#blockFb').classList.add('d-none'); update(); if (focus && name) q('harvested').focus()
  }

  function renderBlocks(keep) {
    $('#blocks').innerHTML = blocks.map(b => { const r = existing.find(x => x.block === b)
      return `<label class="blk ${r ? 'done' : ''}"><input type="radio" name="block" value="${esc(b)}" ${r ? 'disabled' : ''} required><span class="fw-bold">${esc(b)}</span><span class="small ${r ? '' : 'text-muted'}">${r ? `Recorded · ${esc(r.status)}` : 'Not recorded yet'}</span></label>` }).join('')
    const f = free(); pick(keep && f.includes(keep) ? keep : f[0] || '', false)
  }

  async function coverage(keep) {
    const d = q('date').value
    $('#dateText').textContent = d ? nice(d) : ''
    document.querySelectorAll('#dateChips button').forEach(b => b.setAttribute('aria-pressed', String(d === daysAgo(Number(b.dataset.d)))))
    const bad = d > today ? 'Future dates are not allowed. Choose today or an earlier day.' : !d ? 'Choose a date.' : ''
    err(q('date'), bad); $('#dateFb').textContent = bad; $('#dateFb').classList.toggle('d-none', !bad)
    if (bad) { $('#qtyFields').disabled = true; return }
    try { existing = (await get(`/api/v1/fruit-collection?start=${d}&end=${d}&page_size=50`)).items } catch { existing = [] }
    renderBlocks(keep)
    $('#covDate').textContent = short(d)
    const f = free()
    $('#covSummary').textContent = f.length ? `${blocks.length - f.length} of ${blocks.length} recorded · ${f.length} to go` : `All ${blocks.length} blocks are recorded.`
    $('#coverage').innerHTML = blocks.map(b => { const r = existing.find(x => x.block === b)
      return r ? `<li><span>${esc(b)}<br><span class="text-muted small">${fmt(r.collected)} t collected</span></span>${badge(r.status)}</li>`
        : `<li><span>${esc(b)}</span><button type="button" class="btn btn-sm btn-outline-primary" data-pick="${esc(b)}">Enter now</button></li>` }).join('')
    const none = !f.length
    $('#allDone').classList.toggle('d-none', !none)
    if (none) $('#allDone').innerHTML = `Every block already has a record for <strong>${esc(nice(d))}</strong>. Pick another date above, or open <a href="records.html">Field records</a> to edit a draft.`
    $('#qtyFields').disabled = none
  }

  function update() {
    const h = num(q('harvested').value), c = num(q('collected').value), t = num(q('transported').value), left = h != null && c != null ? h - c : null
    const tile = $('#leftTile'); tile.className = 'left-tile' + (left == null ? '' : left < 0 ? ' bad' : left > 0 ? ' warn' : ' ok')
    $('#leftVal').textContent = left == null ? '–' : left.toFixed(3)
    $('#leftMsg').textContent = left == null ? 'Calculated from harvested and collected' : left < 0 ? 'Collected is more than harvested' : left > 0 ? 'A reason is required below' : 'Everything harvested was collected'
    $('#meterBar').style.width = (h > 0 && c != null ? Math.min(100, c / h * 100) : 0) + '%'
    $('#reasonGroup').classList.toggle('d-none', !(left > 0)); q('shortfall_reason').required = left > 0
    err(q('collected'), left < 0 ? `Collected (${c} t) is more than harvested (${h} t).` : '')
    err(q('transported'), t != null && c != null && t > c ? `Transported (${t} t) is more than collected (${c} t).` : '')
    $('#nextHint').textContent = free().length > 1 ? 'After saving, the next block is selected for you.' : ''
  }

  const recent = () => get(`/api/v1/fruit-collection?sort=-date&page_size=5&start=${daysAgo(365)}&end=${today}`).then(d => {
    $('#recent').innerHTML = d.items.length ? d.items.map(r => `<li><span>${esc(short(r.date))} · ${esc(r.block)}<br><span class="text-muted">${fmt(r.collected)} t collected</span></span>${badge(r.status)}</li>`).join('') : '<li class="text-muted">No records yet.</li>'
  }).catch(e => { $('#recent').innerHTML = `<li class="text-danger" role="alert">${esc(e.message)}</li>` })

  form.addEventListener('input', e => { if (e.target.id !== 'date' && e.target.name !== 'block') dirty = true; update() })
  form.addEventListener('change', e => { if (e.target.name === 'block') pick(e.target.value, true); if (e.target.id === 'date') coverage(chosen()) })
  $('#dateChips').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { q('date').value = daysAgo(Number(b.dataset.d)); coverage(chosen()) } })
  $('#coverage').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) { pick(b.dataset.pick, true); $('#qtyFields').scrollIntoView({ behavior: 'smooth', block: 'start' }) } })
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = '' } })  // protect half-typed entries
  $('#saveSubmit').addEventListener('click', () => { submitAfter = true; form.requestSubmit() })

  bindForm(form, async () => {
    const wantSubmit = submitAfter; submitAfter = false
    if (!chosen()) { $('#blockFb').textContent = 'Choose a block.'; $('#blockFb').classList.remove('d-none'); throw new Error('Choose a block before saving.') }
    const draftBtn = $('#saveDraft'), subBtn = $('#saveSubmit'), labels = [draftBtn.textContent, subBtn.textContent]
    ;(wantSubmit ? subBtn : draftBtn).textContent = 'Saving…'; subBtn.disabled = true
    try {
      const rec = await post('/api/v1/fruit-collection', { date: q('date').value, block: chosen(), harvested: num(q('harvested').value), collected: num(q('collected').value), transported: num(q('transported').value),
        harvesters: num(q('harvesters').value), collectors: num(q('collectors').value), reason: q('shortfall_reason').value || null, remarks: q('remarks').value || null }, { key })
      key = uuid(); dirty = false
      const saved = chosen()
      if (wantSubmit) {
        try { await request(`/api/v1/fruit-collection/${rec.id}/submit`, { method: 'POST' }); toast('ok', `${saved}: saved and submitted for approval.`) }
        catch (e) { toast('warn', `${saved}: saved as a draft, but it could not be submitted (${e.message}).`) }
      } else toast('ok', `${saved}: saved as a draft. Submit it from Field records when ready.`)
      ;['harvested', 'collected', 'transported', 'harvesters', 'collectors', 'shortfall_reason', 'remarks'].forEach(k => { q(k).value = '' })
      form.classList.remove('was-validated')
      await Promise.all([coverage(), recent()])  // next free block is selected automatically
      if (free().length) q('harvested').focus()
    } finally { draftBtn.textContent = labels[0]; subBtn.textContent = labels[1]; subBtn.disabled = false }
  })

  await Promise.all([coverage(), recent()])
}
main()
