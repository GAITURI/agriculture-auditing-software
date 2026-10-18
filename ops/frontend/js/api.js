import { API_BASE } from './config.js'
import { clearSession, getSession, refresh } from './auth.js'

export class ApiError extends Error {
  constructor(status, code, message, details = null) { super(message); this.status = status; this.code = code; this.details = details }
}

async function send(path, { method, headers, body, timeout }) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeout)
  const s = getSession()
  try {
    return await fetch(API_BASE + path, { method, body, signal: ctl.signal, headers: { ...(s ? { Authorization: `Bearer ${s.access_token}` } : {}), ...headers } })
  } catch (e) {
    throw new ApiError(0, 'network', e.name === 'AbortError' ? 'The server took too long to respond. Try again.' : 'Cannot reach the server. Check your connection and that the API is running.')
  } finally { clearTimeout(timer) }
}

function expire() {
  clearSession()
  const next = encodeURIComponent(window.location.pathname.split('/').pop() || 'dashboard.html')
  window.location.assign(`login.html?expired=1&next=${next}`)
}

/** json: object body; form: FormData; key: Idempotency-Key. Tokens are never logged. */
export async function request(path, { method = 'GET', json, form, key, timeout = 15000 } = {}) {
  const headers = {}
  let body
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json) } else if (form) body = form
  if (key) headers['Idempotency-Key'] = key
  let res = await send(path, { method, headers, body, timeout })
  if (res.status === 401 && getSession() && await refresh()) res = await send(path, { method, headers, body, timeout })
  const data = await res.json().catch(() => null)
  if (res.ok) return data
  if (res.status === 401) { expire(); throw new ApiError(401, 'session_expired', 'Your session expired. Sign in again.') }
  const e = data?.error
  const fallback = { 403: 'You do not have permission to do this.', 413: 'The file is too large.', 429: 'Too many requests. Wait a moment and try again.' }[res.status]
  throw new ApiError(res.status, e?.code || 'error', e?.message || fallback || `Request failed (${res.status}). Try again.`, e?.details || null)
}

export const get = (path, opts) => request(path, opts)
export const post = (path, json, opts) => request(path, { method: 'POST', json, ...opts })
export const patch = (path, json, opts) => request(path, { method: 'PATCH', json, ...opts })
export const del = (path, opts) => request(path, { method: 'DELETE', ...opts })  // the current API exposes no DELETE routes

/** Org configuration (blocks, cycle dates, limits). Rarely changes, so it is served from sessionStorage and refreshed in the background. */
let pendingCfg = null
export async function getConfig() {
  const hit = JSON.parse(sessionStorage.getItem('scipec.cfg') || 'null')
  const fresh = () => (pendingCfg ||= request('/api/v1/config').then(d => { sessionStorage.setItem('scipec.cfg', JSON.stringify({ t: Date.now(), d })); return d }).finally(() => { pendingCfg = null }))
  if (hit && Date.now() - hit.t < 600000) { if (Date.now() - hit.t > 60000) fresh().catch(() => {}); return hit.d }
  return fresh()
}
