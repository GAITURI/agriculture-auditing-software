import { initPage } from './navigation.js'
import { get, post, getConfig } from './api.js'
import { can } from './auth.js'
import { $, bindForm, esc, fmt, loadTable, uuid } from './components.js'
import { toast } from './notifications.js'

const n = v => (v === '' || v == null ? null : Number(v))

async function main() {
  if (!initPage()) return
  const cfg = await getConfig().catch(e => { toast('error', e.message); return null })
  if (!cfg) return
  const form = $('#dayForm'), q = k => form[k]
  let key = uuid()
  const load = page => loadTable({ tbody: $('#rows'), pager: $('#pager'), path: '/api/v1/factory-production', page, onPage: load, colspan: 6, empty: 'No production days recorded yet.',
    params: { start: cfg.cycle_start, end: cfg.cycle_end },
    row: r => `<tr><td>${esc(r.date)}</td><td>${fmt(r.total_received)}</td><td>${fmt(r.processed)}</td><td>${fmt(r.oil)}</td><td>${r.processed ? fmt(r.oil / r.processed * 100) : '–'}</td><td>${fmt(r.downtime)}</td></tr>` })
  if (!can('factory:write')) { $('#formRow').classList.add('d-none'); load(1); return }
  const today = new Date().toISOString().slice(0, 10)
  q('date').min = cfg.cycle_start; q('date').max = today < cfg.cycle_end ? today : cfg.cycle_end; q('date').value = q('date').max

  const update = () => {
    const parts = ['ffb_banakanuke', 'ffb_batchepo', 'ffb_bakilo'].map(k => n(q(k).value)).filter(v => v != null)
    $('#totalVal').textContent = parts.length ? parts.reduce((a, b) => a + b, 0).toFixed(3) : '–'
    const p = n(q('processed').value), o = n(q('oil').value), tile = $('#oerTile')
    if (p > 0 && o != null) {
      const oer = o / p * 100, okRange = oer >= cfg.oer_min && oer <= cfg.oer_max
      $('#oerVal').textContent = oer.toFixed(2); tile.classList.toggle('bad', !okRange)
      $('#oerMsg').textContent = okRange ? `Within the normal range (${cfg.oer_min}–${cfg.oer_max}%).` : `Outside the normal range (${cfg.oer_min}–${cfg.oer_max}%). It will save, flagged for supervisor review.`
    } else { $('#oerVal').textContent = '–'; tile.classList.remove('bad'); $('#oerMsg').textContent = 'Enter processed FFB and oil produced.' }
    q('oil').setCustomValidity(o != null && p != null && o > p ? 'Oil cannot exceed processed FFB.' : '')
  }
  form.addEventListener('input', update)
  bindForm(form, async () => {
    const out = await post('/api/v1/factory-production', { date: q('date').value, remarks: q('remarks').value || null, ffb_banakanuke: n(q('ffb_banakanuke').value), ffb_batchepo: n(q('ffb_batchepo').value), ffb_bakilo: n(q('ffb_bakilo').value),
      processed: n(q('processed').value), oil: n(q('oil').value), downtime: n(q('downtime').value) }, { key })
    key = uuid()
    out.warnings.length ? toast('warn', `Saved with ${out.warnings.length} warning(s): ${out.warnings.join(' | ')}`) : toast('ok', `Production for ${q('date').value} saved.`)
    ;['ffb_banakanuke', 'ffb_batchepo', 'ffb_bakilo', 'processed', 'oil', 'downtime', 'remarks'].forEach(k => { q(k).value = '' })
    form.classList.remove('was-validated'); update(); load(1)
  })
  update(); load(1)
}
main()
