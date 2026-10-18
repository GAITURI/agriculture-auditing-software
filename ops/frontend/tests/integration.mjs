// Needs a freshly migrated and seeded database (it creates records on fixed dates). API on :8000, static server on :5173:  node tests/integration.mjs
// Exercises the real api.js / auth.js / components.js modules (Node shims for window + sessionStorage). Not a browser test.
import { readFileSync, readdirSync } from 'node:fs'

const calls = []
const store = {}
globalThis.window = { location: { pathname: '/dashboard.html', assign: u => calls.push(u), replace: u => calls.push(u) }, SCIPEC_CONFIG: { apiBase: process.env.API_BASE || 'http://127.0.0.1:8000' } }
globalThis.sessionStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v }, removeItem: k => { delete store[k] } }

const auth = await import('../js/auth.js')
const api = await import('../js/api.js')
const { esc } = await import('../js/components.js')

let failed = 0
const check = async (name, fn) => { try { await fn(); console.log('PASS', name) } catch (e) { failed++; console.log('FAIL', name, '->', e.message) } }
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }
const PROBE = `lockout-${Date.now()}@scipec.test`  // unknown address: exercises the throttle without locking a real account
const as = async role => { auth.clearSession(); return auth.login(`${role}@scipec.test`, 'Test-pass-123') }
const fail = async (p, status) => { try { await p } catch (e) { ok(e.status === status || e.code === status, `expected ${status}, got ${e.status}/${e.code}: ${e.message}`); return e } throw new Error('expected an error') }

if (process.env.NET_FAIL) {
  await check('unreachable API gives a friendly network error', async () => { const e = await fail(api.get('/api/v1/config'), 'network'); ok(/Cannot reach the server/.test(e.message)) })
  process.exit(failed ? 1 : 0)
}

// ---- static pages and assets
const WEB = 'http://127.0.0.1:5173/'
const pages = readdirSync('.').filter(f => f.endsWith('.html'))
for (const p of pages) await check(`page ${p} loads with its CSS/JS assets`, async () => {
  const r = await fetch(WEB + p); ok(r.status === 200, 'status ' + r.status)
  const html = await r.text()
  for (const m of html.matchAll(/(?:href|src)="((?:css|js|vendor)\/[^"?#]+)"/g)) ok((await fetch(WEB + m[1])).status === 200, 'missing asset ' + m[1])
  ok(!/\son[a-z]+=/.test(html), 'inline event handler found')
  ok(!/<script(?![^>]*src=)/.test(html), 'inline script found')
})
await check('no React anywhere in the frontend', async () => {
  const files = [...readdirSync('.', { recursive: true })].filter(f => /\.(html|js|json|mjs)$/.test(f) && !f.includes('node_modules') && !f.includes('vendor') && !f.includes('package-lock') && !f.includes('tests'))
  for (const f of files) ok(!/\breact\b/i.test(readFileSync(f, 'utf8')), 'React mentioned in ' + f)
})
await check('esc() neutralises HTML', () => ok(esc('<img src=x onerror=alert(1)>"\'') === '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;'))

// ---- authentication
await check('wrong password -> clear message', async () => { const e = await fail(auth.login(PROBE, 'nope'), 401); ok(e.message === 'Email or password is incorrect.') })
await check('rate limiting -> 429 message', async () => { for (let i = 0; i < 5; i++) await auth.login(PROBE, 'nope').catch(() => {}); const e = await fail(auth.login(PROBE, 'nope'), 429); ok(/Too many failed sign-ins/.test(e.message)) })
await check('valid login stores session and permissions', async () => { const u = await as('admin'); ok(u.role === 'admin' && auth.can('fruit:write') && auth.getSession().access_token) })
await check('request carries the bearer token (GET /config)', async () => { const c = await api.get('/api/v1/config'); ok(c.blocks.includes('Bakilo') && c.blocks.length === 3) })
await check('expired access token is refreshed transparently', async () => { const s = auth.getSession(); auth.setSession({ ...s, access_token: 'garbage' }); const me = await api.get('/api/v1/auth/me'); ok(me.email === 'admin@scipec.test' && auth.getSession().access_token !== 'garbage') })
await check('expired session redirects to login and clears storage', async () => { const s = auth.getSession(); auth.setSession({ ...s, access_token: 'garbage', refresh_token: 'garbage' }); calls.length = 0; await fail(api.get('/api/v1/auth/me'), 'session_expired'); ok(auth.getSession() === null && calls.some(u => u.startsWith('login.html?expired=1'))) })
await check('logout clears the session', async () => { await as('admin'); calls.length = 0; auth.logout(); ok(auth.getSession() === null && calls.includes('login.html')) })
await check('401 without session is reported (no token sent)', async () => { auth.clearSession(); await fail(api.get('/api/v1/fruit-collection'), 'session_expired') })

// ---- permissions (403 is distinct)
await check('auditor cannot create records -> 403 with message', async () => { await as('auditor'); const e = await fail(api.post('/api/v1/fruit-collection', {}), 403); ok(/permission|role/i.test(e.message)) })

// ---- field workflow through the client
const rec = { date: '2026-09-05', block: 'Batchepo', harvested: 10, collected: 10, transported: 10 }
let created
await check('create with Idempotency-Key twice -> one record', async () => {
  await as('field_supervisor'); const key = crypto.randomUUID()
  created = await api.post('/api/v1/fruit-collection', rec, { key }); const again = await api.post('/api/v1/fruit-collection', rec, { key })
  ok(created.id === again.id && created.status === 'draft')
})
await check('validation error surfaces a readable message', async () => { const e = await fail(api.post('/api/v1/fruit-collection', { ...rec, date: '2026-09-06', collected: 12 }), 422); ok(/collected/i.test(e.message)) })
await check('PATCH then stale PATCH -> version_conflict', async () => {
  const up = await api.patch(`/api/v1/fruit-collection/${created.id}`, { version: created.version, remarks: 'wet' }); ok(up.version === created.version + 1)
  await fail(api.patch(`/api/v1/fruit-collection/${created.id}`, { version: created.version, remarks: 'x' }), 'version_conflict')
})
await check('submit -> approve by another user; paginated list', async () => {
  await api.request(`/api/v1/fruit-collection/${created.id}/submit`, { method: 'POST' })
  await as('operations_manager'); const ap = await api.request(`/api/v1/fruit-collection/${created.id}/approve`, { method: 'POST' }); ok(ap.status === 'approved')
  const list = await api.get('/api/v1/fruit-collection?page=1&page_size=5&status=approved'); ok(list.total >= 1 && list.items[0].block)
})
await check('dashboard summary excludes drafts, includes approved', async () => { const s = await api.get('/api/v1/dashboard/summary?start=2026-09-01&end=2026-09-30'); ok(s.transported >= 10 && 'open_cases' in s) })

// ---- deliveries and cases
await check('dispatch -> short receipt opens a case -> resolve', async () => {
  const ref = 'WB-' + Date.now()
  await as('field_supervisor'); const d = await api.post('/api/v1/deliveries', { reference: ref, block: 'Bakilo', dispatched_at: '2026-09-07T23:00:00+00:00', dispatched_qty: 20 }, { key: crypto.randomUUID() })
  await as('factory_operator'); const r = await api.post(`/api/v1/deliveries/${d.id}/receipt`, { received_at: '2026-09-08T02:00:00+00:00', received_qty: 18.7 }); ok(r.case_id && Math.abs(r.variance + 1.3) < 1e-9)
  await as('reconciliation_officer'); const c = await api.get(`/api/v1/reconciliation/${r.case_id}`)
  await fail(api.post(`/api/v1/reconciliation/${c.id}/resolve`, { reason: 'x', version: c.version }), 422)
  const res = await api.post(`/api/v1/reconciliation/${c.id}/resolve`, { reason: 'Spillage on the haul road', version: c.version }); ok(res.status === 'resolved' && res.variance === -1.3)
})

// ---- import with FormData
await check('import: preview then commit (multipart through api.js)', async () => {
  await as('operations_manager')
  const mk = () => { const f = new FormData(); f.append('file', new Blob([readFileSync('/tmp/wb.xlsx')]), 'wb.xlsx'); return f }
  const prev = await api.request('/api/v1/import?commit=false', { method: 'POST', form: mk() }); ok(prev.inserts === 1 && !prev.committed)
  const done = await api.request('/api/v1/import?commit=true', { method: 'POST', form: mk(), key: crypto.randomUUID() }); ok(done.committed)
})
await check('non-xlsx upload is rejected with a readable message', async () => { const f = new FormData(); f.append('file', new Blob(['hello']), 'x.xlsx'); const e = await fail(api.request('/api/v1/import', { method: 'POST', form: f }), 415); ok(/xlsx/i.test(e.message)) })

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
