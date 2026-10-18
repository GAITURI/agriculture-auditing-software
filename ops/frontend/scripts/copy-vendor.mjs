// Copies Bootstrap's built files next to the app so no CDN is needed (works on Windows, macOS, Linux).
import { copyFileSync, mkdirSync } from 'node:fs'
mkdirSync('vendor', { recursive: true })
for (const f of ['css/bootstrap.min.css', 'js/bootstrap.bundle.min.js'])
  copyFileSync(`node_modules/bootstrap/dist/${f}`, `vendor/${f.split('/').pop()}`)
console.log('Bootstrap copied to vendor/')
