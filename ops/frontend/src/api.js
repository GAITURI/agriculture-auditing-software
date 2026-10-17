const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const KEY = 'scipec.session'  // sessionStorage: cleared when the tab closes

export const session = {
  get: () => JSON.parse(sessionStorage.getItem(KEY) || 'null'),
  set: s => sessionStorage.setItem(KEY, JSON.stringify(s)),
  clear: () => sessionStorage.removeItem(KEY),
}
let onExpire = () => {}
export const setOnExpire = f => { onExpire = f }

export const explain = (body, status) => body?.error?.message || `Request failed (${status})`
export const json = (data, key) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(data) })
export const num = v => (v === '' || v == null ? null : Number(v))
export const fmt = v => (v == null ? '–' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }))
export const clamp = (d, lo, hi) => (d < lo ? lo : d > hi ? hi : d)

async function send(path, opts) {
  const s = session.get()
  const headers = { ...(opts.headers || {}), ...(s ? { Authorization: `Bearer ${s.access_token}` } : {}) }
  try { return await fetch(`${API}${path}`, { ...opts, headers }) }
  catch { throw new Error(`Cannot reach the API at ${API}. Check that the backend is running.`) }
}

export async function request(path, opts = {}) {
  let res = await send(path, opts)
  const s = session.get()
  if (res.status === 401 && s?.refresh_token && !path.includes('/auth/')) {
    const r = await fetch(`${API}/api/v1/auth/refresh`, json({ refresh_token: s.refresh_token }))
    if (r.ok) { session.set({ ...s, ...(await r.json()) }); res = await send(path, opts) }
    else { session.clear(); onExpire() }
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) { const e = new Error(explain(body, res.status)); e.body = body; e.status = res.status; throw e }
  return body
}

export async function login(email, password) {
  const body = await request('/api/v1/auth/login', json({ email, password }))
  session.set(body)
  return body.user
}
