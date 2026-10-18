import { PAGE_SIZE } from './config.js'
import { request } from './api.js'

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c])  // every dynamic value goes through this
export const fmt = v => (v == null ? '–' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 }))
export const badge = v => `<span class="tagx t-${esc(v)}">${esc(String(v).replace('_', ' '))}</span>`
export const isoLocal = v => new Date(v).toISOString()  // datetime-local -> UTC ISO with offset, as the API requires
export const uuid = () => crypto.randomUUID()
const IC = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  entry: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  records: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  factory: '<path d="M3 21V9l6 4V9l6 4V4h4v17z"/>',
  truck: '<path d="M1 6h13v10H1zM14 10h4l3 3v3h-7z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  scale: '<path d="M12 3v18M6 21h12M5 7h14"/><path d="M5 7l-3 7a3 3 0 006 0zM19 7l-3 7a3 3 0 006 0z"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z"/>',
  bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M10 21a2 2 0 004 0"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
  oil: '<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>',
}
export const icon = (n, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${IC[n]}</svg>`
/** Percentage change of cur vs prev; null when it cannot be computed (missing or zero baseline). */
export const pct = (cur, prev) => (cur == null || prev == null || prev === 0 ? null : (cur - prev) / Math.abs(prev) * 100)
export const $ = (sel, root = document) => root.querySelector(sel)
export const modal = id => window.bootstrap.Modal.getOrCreateInstance(document.getElementById(id))

export function fillSelect(sel, options, all) {
  sel.innerHTML = (all ? `<option value="">${esc(all)}</option>` : '') + options.map(o => `<option>${esc(o)}</option>`).join('')
}

/** Server-paginated table with skeleton, empty and error (with retry) states. Returns the loaded items. */
export async function loadTable({ tbody, pager, path, params = {}, page = 1, row, colspan, empty, onPage }) {
  tbody.innerHTML = Array.from({ length: 4 }, () => `<tr><td colspan="${colspan}"><span class="skeleton"></span></td></tr>`).join('')
  tbody.setAttribute('aria-busy', 'true')
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)), page, page_size: PAGE_SIZE })
  try {
    const d = await request(`${path}?${q}`)
    tbody.innerHTML = d.items.length ? d.items.map(row).join('')
      : `<tr><td colspan="${colspan}" class="text-center text-muted py-4">${esc(empty)}</td></tr>`
    renderPager(pager, d, onPage)
    return d.items
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-danger py-4" role="alert">${esc(e.message)} <button type="button" class="btn btn-sm btn-outline-secondary ms-2" data-retry>Retry</button></td></tr>`
    tbody.querySelector('[data-retry]').addEventListener('click', () => onPage(page))
    if (pager) pager.innerHTML = ''
    return []
  } finally { tbody.removeAttribute('aria-busy') }
}

function renderPager(el, d, onPage) {
  if (!el) return
  const pages = Math.max(1, Math.ceil(d.total / d.page_size))
  el.innerHTML = `<div class="d-flex align-items-center gap-2 flex-wrap"><span class="text-muted small">${d.total} record(s) · page ${d.page} of ${pages}</span>
    <button class="btn btn-sm btn-outline-primary" data-go="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>Previous</button>
    <button class="btn btn-sm btn-outline-primary" data-go="${d.page + 1}" ${d.page >= pages ? 'disabled' : ''}>Next</button></div>`
  el.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => onPage(Number(b.dataset.go))))
}

/** Bootstrap validation + submit lock + inline server error. onSubmit may throw; its message is shown in .form-error. */
export function bindForm(form, onSubmit) {
  form.noValidate = true
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    const err = $('.form-error', form)
    err.classList.add('d-none')
    if (!form.checkValidity()) { form.classList.add('was-validated'); return }
    const btn = $('[type=submit]', form)
    btn.disabled = true
    try { await onSubmit() } catch (e) { err.textContent = e.message; err.classList.remove('d-none') } finally { btn.disabled = false }
  })
}
export function resetForm(form) { form.reset(); form.classList.remove('was-validated'); $('.form-error', form).classList.add('d-none') }

let confirmEl
export function confirmAction(message, okLabel = 'Confirm') {
  if (!confirmEl) {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal fade" id="confirmModal" tabindex="-1" aria-labelledby="confirmTitle" aria-hidden="true"><div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h2 class="modal-title fs-5" id="confirmTitle">Please confirm</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
      <div class="modal-body" id="confirmBody"></div><div class="modal-footer"><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button><button class="btn btn-primary" id="confirmOk"></button></div></div></div></div>`)
    confirmEl = document.getElementById('confirmModal')
  }
  $('#confirmBody').textContent = message
  $('#confirmOk').textContent = okLabel
  const m = window.bootstrap.Modal.getOrCreateInstance(confirmEl)
  return new Promise(resolve => {
    let done = false
    const finish = v => { if (!done) { done = true; resolve(v) } }
    $('#confirmOk').onclick = () => { finish(true); m.hide() }
    confirmEl.addEventListener('hidden.bs.modal', () => finish(false), { once: true })
    m.show()
  })
}

export function downloadCsv(name, head, rows) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: name })
  a.click(); URL.revokeObjectURL(a.href)
}


