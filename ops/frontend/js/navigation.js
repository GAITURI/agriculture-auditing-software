import { can, logout } from './auth.js'
import { get } from './api.js'
import { guard } from './guards.js'
import { WEBSITE } from './config.js'
import { esc, icon } from './components.js'

// [page, label, icon, permission, group]
export const NAV = [
  ['dashboard.html', 'Overview', 'overview', 'report:read', 'Monitor'], ['field-entry.html', 'Field entry', 'entry', 'fruit:write', 'Record'],
  ['factory-entry.html', 'Factory entry', 'factory', 'factory:read', 'Record'], ['deliveries.html', 'Deliveries', 'truck', 'delivery:read', 'Record'],
  ['records.html', 'Field records', 'records', 'fruit:read', 'Review'], ['reconciliation.html', 'Daily reconciliation', 'scale', 'report:read', 'Review'],
  ['cases.html', 'Reconciliation cases', 'alert', 'reconcile:read', 'Review'], ['import.html', 'Import workbook', 'upload', 'import:write', 'Data']]

const setTheme = t => {
  document.documentElement.setAttribute('data-bs-theme', t); localStorage.setItem('scipec.theme', t)
  const b = document.getElementById('themeBtn')
  if (b) b.innerHTML = `<span>${t === 'dark' ? 'Dark' : 'Light'} mode</span>${icon(t === 'dark' ? 'moon' : 'sun', 18)}`
}

/** Guards the page, draws the top bar and the navigation drawer, and returns the user (or null when the page must not run). */
export function initPage() {
  const { dataset } = document.body
  const g = guard(dataset.perm)
  if (!g) return null
  const { user } = g
  const name = user.full_name || user.email.split('@')[0]
  const groups = ['Monitor', 'Record', 'Review', 'Data'].map(grp => {
    const items = NAV.filter(([, , , p, gr]) => gr === grp && can(p))
    return items.length ? `<div class="nav-label">${grp}</div>` + items.map(([href, label, ic]) =>
      `<a class="drawer-link" href="${href}" ${href === dataset.page ? 'aria-current="page"' : ''}>${icon(ic)}<span>${esc(label)}</span></a>`).join('') : ''
  }).join('')
  document.getElementById('sidebar').innerHTML = `<div class="offcanvas-header"><div class="sb-brand"><span class="sb-logo" aria-hidden="true">S</span><div><strong id="drawerTitle">SCIPEC</strong><small>Operations</small></div></div>
      <button class="btn-close btn-close-white" data-bs-dismiss="offcanvas" aria-label="Close menu"></button></div>
    <div class="offcanvas-body d-flex flex-column"><nav aria-label="Main">${groups}</nav>
      <div class="drawer-foot mt-auto">
        <div class="drawer-user"><span class="avatar" aria-hidden="true">${esc(name.slice(0, 2).toUpperCase())}</span><div class="min-w-0"><div class="fw-bold text-truncate">${esc(name)}</div>
          <div class="small text-truncate" style="color:#8fb09d">${esc(user.role.replace(/_/g, ' '))} · ${esc(user.email)}</div></div></div>
        <button class="drawer-btn" id="themeBtn" type="button" aria-label="Switch between light and dark mode"></button>
        <button class="drawer-btn out" id="signOut" type="button"><span>Sign out</span>${icon('logout', 18)}</button>
        <a class="drawer-site" href="${WEBSITE}" target="_blank" rel="noopener">scipec.vercel.app</a></div></div>`
  document.getElementById('sidebar').setAttribute('aria-labelledby', 'drawerTitle')
  const quick = can('fruit:write') && !['field-entry.html', 'records.html'].includes(dataset.page) ? `<a class="btn btn-primary btn-sm d-none d-sm-inline-flex align-items-center gap-2" href="field-entry.html">${icon('plus', 16)}Record collection</a>` : ''
  document.getElementById('topbar').innerHTML = `<div class="topbar-in">
    <button class="icon-btn" id="menuBtn" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebar" aria-controls="sidebar" aria-label="Open menu">${icon('menu')}</button>
    <div class="flex-grow-1 min-w-0"><h1 class="fs-5 fw-bold m-0 text-truncate">${esc(dataset.title)}</h1>${dataset.subtitle ? `<div class="page-sub text-truncate">${esc(dataset.subtitle)}</div>` : ''}</div>
    ${quick}${can('reconcile:read') ? `<a class="icon-btn" href="cases.html" id="bell" aria-label="Open reconciliation cases">${icon('bell')}</a>` : ''}</div>`
  document.documentElement.classList.remove('app-pending')  // shell is drawn: reveal the page content
  setTheme(document.documentElement.getAttribute('data-bs-theme') || 'light')
  document.getElementById('themeBtn').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark'))
  document.getElementById('signOut').addEventListener('click', logout)
  const drawer = document.getElementById('sidebar'), menu = document.getElementById('menuBtn')
  drawer.addEventListener('shown.bs.offcanvas', () => { menu.setAttribute('aria-expanded', 'true') })
  drawer.addEventListener('hidden.bs.offcanvas', () => { menu.setAttribute('aria-expanded', 'false'); menu.focus() })
  if (can('reconcile:read')) {
    const paint = k => {
      const b = document.getElementById('bell')
      b.querySelector('.count')?.remove()
      if (!k) return b.setAttribute('aria-label', 'Open reconciliation cases')
      b.insertAdjacentHTML('beforeend', `<span class="count">${k > 99 ? '99+' : k}</span>`)
      b.setAttribute('aria-label', `${k} open reconciliation case${k > 1 ? 's' : ''}`)
    }
    const hit = JSON.parse(sessionStorage.getItem('scipec.bell') || 'null')
    if (hit) paint(hit.n)  // instant from the last visit
    if (!hit || Date.now() - hit.t > 30000) get('/api/v1/reconciliation?status=open&page_size=1').then(d => { sessionStorage.setItem('scipec.bell', JSON.stringify({ t: Date.now(), n: d.total })); paint(d.total) }).catch(() => {})
  }
  if (g.denied) {
    document.getElementById('content').innerHTML = `<div class="alert alert-warning" role="alert"><strong>No access.</strong> Your role (${esc(user.role.replace(/_/g, ' '))}) cannot open this page. Ask an administrator if you need it.</div>`
    return null
  }
  return user
}
