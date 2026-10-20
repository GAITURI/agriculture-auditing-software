// Production build: one minified bundle per page (+ shared chunk), content-hashed file names, gzip copies.
import { build, transform } from 'esbuild'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const hash = b => createHash('sha1').update(b).digest('hex').slice(0, 10)
rmSync('dist', { recursive: true, force: true })
for (const d of ['js', 'css', 'vendor']) mkdirSync(`dist/${d}`, { recursive: true })

cpSync('vendor/fonts', 'dist/vendor/fonts', { recursive: true })
const pages = readdirSync('.').filter(f => f.endsWith('.html'))
const entries = [...new Set(pages.flatMap(f => [...readFileSync(f, 'utf8').matchAll(/src="js\/([\w-]+)\.js"><\/script>\s*<\/body>/g)].map(m => m[1])))]
const out = await build({ entryPoints: entries.map(e => `js/${e}.js`), bundle: true, splitting: true, format: 'esm', minify: true, sourcemap: true, target: 'es2020',
  outdir: 'dist/js', entryNames: '[name]-[hash]', chunkNames: 'chunk-[hash]', metafile: true, logLevel: 'warning' })

const map = {}
for (const [file, m] of Object.entries(out.metafile.outputs)) if (m.entryPoint) map[`js/${m.entryPoint.split('/').pop()}`] = file.replace(/^dist\//, '')
const hashedCopy = (src, dir, name, ext, transformFn) => {
  const body = transformFn ? transformFn(readFileSync(src)) : readFileSync(src)
  const dest = `${dir}/${name}-${hash(body)}.${ext}`
  writeFileSync(`dist/${dest}`, body)
  return dest
}
map['js/theme-init.js'] = `js/theme-init-${hash(readFileSync('js/theme-init.js'))}.js`
writeFileSync(`dist/${map['js/theme-init.js']}`, (await transform(readFileSync('js/theme-init.js', 'utf8'), { minify: true })).code)
for (const [src, name, ext] of [['css/theme.css', 'theme', 'css'], ['css/styles.css', 'styles', 'css'], ['vendor/bootstrap.min.css', 'bootstrap', 'css'], ['vendor/bootstrap.bundle.min.js', 'bootstrap-bundle', 'js']])
  map[src] = hashedCopy(src, src.split('/')[0], name, ext)
writeFileSync('dist/env.js', process.env.API_BASE !== undefined ? `window.SCIPEC_CONFIG={apiBase:${JSON.stringify(process.env.API_BASE)}}\n` : readFileSync('env.js'))

for (const f of pages) {
  let html = readFileSync(f, 'utf8')
  for (const [from, to] of Object.entries(map)) html = html.replaceAll(`"${from}"`, `"${to}"`)
  writeFileSync(`dist/${f}`, html)
}
let raw = 0, gz = 0
for (const dir of ['.', 'js', 'css', 'vendor']) for (const f of readdirSync(`dist/${dir}`)) {
  if (!/\.(html|js|css)$/.test(f)) continue
  const p = dir === '.' ? `dist/${f}` : `dist/${dir}/${f}`, b = readFileSync(p), z = gzipSync(b, { level: 9 })
  writeFileSync(p + '.gz', z); raw += b.length; gz += z.length
}
console.log(`built dist/: ${pages.length} pages, ${entries.length} bundles. ${(raw / 1024).toFixed(0)} KB raw -> ${(gz / 1024).toFixed(0)} KB gzip`)
