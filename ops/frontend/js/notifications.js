const COLORS = { ok: 'success', error: 'danger', warn: 'warning', info: 'secondary' }

export function toast(kind, message) {
  const box = document.getElementById('toasts')
  if (!box) return
  const el = document.createElement('div')
  el.className = `toast align-items-center border-0 text-bg-${COLORS[kind] || 'secondary'}`
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status')
  const row = document.createElement('div'); row.className = 'd-flex'
  const body = document.createElement('div'); body.className = 'toast-body'; body.textContent = message  // textContent: never HTML
  const close = document.createElement('button'); close.type = 'button'; close.className = 'btn-close btn-close-white me-2 m-auto'; close.setAttribute('data-bs-dismiss', 'toast'); close.setAttribute('aria-label', 'Close')
  row.append(body, close); el.append(row); box.append(el)
  const t = new window.bootstrap.Toast(el, { delay: kind === 'error' || kind === 'warn' ? 9000 : 4000 })
  el.addEventListener('hidden.bs.toast', () => el.remove())
  t.show()
}
