// Session handling. The backend issues bearer tokens in the JSON body (no cookie option exists), so tokens are kept
// in sessionStorage: cleared when the tab closes, but readable by any script on the page (an XSS flaw would expose them).
// That is weaker than an HttpOnly cookie. Mitigations here: no inline scripts, all dynamic text escaped, short access-token life.
import { API_BASE } from './config.js'

const KEY = 'scipec.session'
export const getSession = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') } catch { return null } }
export const setSession = s => sessionStorage.setItem(KEY, JSON.stringify(s))
export const clearSession = () => { for (const k of [KEY, 'scipec.cfg', 'scipec.bell']) sessionStorage.removeItem(k) }
export const currentUser = () => getSession()?.user || null
export const can = perm => { const u = currentUser(); return !!u && (u.permissions.includes('*') || u.permissions.includes(perm)) }

function loginMessage(status, body) {
  if (status === 429) return 'Too many failed sign-ins. Wait a few minutes before trying again.'
  if (status === 401) return 'Email or password is incorrect.'
  return body?.error?.message || `Sign-in failed (${status}). Try again.`
}

async function post(path, payload) {
  try {
    return await fetch(API_BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  } catch { throw new Error('Cannot reach the server. Check that the API is running and that your connection works.') }
}

export async function login(email, password) {
  const res = await post('/api/v1/auth/login', { email, password })
  const body = await res.json().catch(() => null)
  if (!res.ok) { const e = new Error(loginMessage(res.status, body)); e.status = res.status; throw e }
  setSession(body)
  return body.user
}

let inflight = null  // one refresh at a time, even when several requests get a 401 together
export function refresh() {
  inflight ||= (async () => {
    const s = getSession()
    if (!s?.refresh_token) return false
    try {
      const res = await post('/api/v1/auth/refresh', { refresh_token: s.refresh_token })
      if (!res.ok) return false
      setSession({ ...s, ...(await res.json()) })
      return true
    } catch { return false } finally { setTimeout(() => { inflight = null }) }
  })()
  return inflight
}

export function logout() { clearSession(); window.location.assign('login.html') }
