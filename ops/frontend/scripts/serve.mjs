// Static server + same-origin API proxy.   node scripts/serve.mjs          -> serves dist/ (run `npm run build` first)
//                                          node scripts/serve.mjs --src    -> serves the source files, no caching (editing)
// Env: PORT (5173), API_TARGET (http://127.0.0.1:8000).
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'

const SRC = process.argv.includes('--src')
const ROOT = resolve(SRC ? '.' : 'dist')
const PORT = Number(process.env.PORT || 5173)
const API = new URL(process.env.API_TARGET || 'http://127.0.0.1:8000')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
const proxied = p => p.startsWith('/api/') || p.startsWith('/health') || p === '/docs' || p === '/openapi.json'

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (proxied(url.pathname)) {
    const up = http.request({ host: API.hostname, port: API.port, path: req.url, method: req.method, headers: { ...req.headers, host: API.host } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    up.on('error', () => { res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":{"code":"api_unreachable","message":"The API is not reachable. Is the backend running?"}}') })
    req.pipe(up)
    return
  }
  let path = decodeURIComponent(url.pathname)
  if (path === '/') path = '/index.html'
  const file = resolve(ROOT, '.' + path)
  if (!file.startsWith(ROOT + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found') }
  const ext = extname(file)
  const hashed = /[-.][A-Za-z0-9]{8,}\.(js|css)$/.test(file) || ext === '.woff2'  // content-hashed names never change -> cache for a year
  const h = { 'content-type': TYPES[ext] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': SRC ? 'no-store' : hashed ? 'public, max-age=31536000, immutable' : 'no-cache' }
  const gz = !SRC && /gzip/.test(req.headers['accept-encoding'] || '') && ['.html', '.js', '.css'].includes(ext) && existsSync(file + '.gz')
  if (gz) { h['content-encoding'] = 'gzip'; h.vary = 'accept-encoding' }
  res.writeHead(200, h)
  createReadStream(gz ? file + '.gz' : file).pipe(res)
}).listen(PORT, '127.0.0.1', () => console.log(`Frontend: http://127.0.0.1:${PORT} (${SRC ? 'source, no cache' : 'dist'}) · API proxied to ${API.origin}`))
