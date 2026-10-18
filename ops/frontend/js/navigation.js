import { can, logout } from './auth.js'
import { get } from './api.js'
import { guard } from './guards.js'
import { WEBSITE } from './config.js'
import { esc, icon } from './components.js'

export const NAV = [
  ['dashboard.html', 'Overview', 'overview', 'report:read'], ['field-entry.html', 'Field entry', 'entry', 'fruit:write'], ['records.html', 'Field records', 'records', 'fruit:read'],
  ['factory-entry.html', 'Factory entry', 'factory', 'factory:read'], ['deliveries.html', 'Deliveries', 'truck', 'delivery:read'], ['reconciliation.html', 'Daily reconciliation', 'scale', 'report:read'],
  ['cases.html', 'Reconciliation cases', 'alert', 'reconcile:read'], ['import.html', 'Import workbook', 'upload', 'import:write']]

const setTheme = t => {
  document.documentElement.setAttribute('data-bs-theme', t); localStorage.setItem('scipec.theme', t)
  const b = document.getElementById('themeBtn')
  if (b) b.innerHTML = `<span class="nav-label">${t === 'dark' ? 'Dark mode' : 'Light mode'}</span>${icon(t === 'dark' ? 'moon' : 'sun')}`
}

/** Guards the page, draws the shell (sidebar, hamburger, top bar), and returns the user, or null when the page must not run. */
export function initPage() {
  const { dataset } = document.body
  const g = guard(dataset.perm)
  if (!g) return null
  const { user } = g
  const links = NAV.filter(([, , , p]) => can(p)).map(([href, label, ic]) =>
    `<li><a class="nav-link" href="${href}" title="${esc(label)}" ${href === dataset.page ? 'aria-current="page"' : ''}>${icon(ic)}<span class="nav-label">${esc(label)}</span></a></li>`).join('')
  document.getElementById('sidebar').innerHTML = `<div class="offcanvas-header d-lg-none"><span class="fw-bold">SCIPEC Operations</span><button class="btn-close btn-close-white" data-bs-dismiss="offcanvas" data-bs-target="#sidebar" aria-label="Close menu"></button></div>
    <div class="offcanvas-body d-flex flex-column p-3"><a class="sb-brand" href="dashboard.html"><span class="sb-logo" aria-hidden="true">S</span><span class="nav-label"><strong>SCIPEC</strong><small>Operations</small></span></a>
    <nav aria-label="Main"><ul class="nav flex-column gap-1">${links}</ul></nav>
    <div class="mt-auto sb-foot"><button class="theme-switch" id="themeBtn" type="button" aria-label="Switch between light and dark mode"></button><a href="${WEBSITE}" target="_blank" rel="noopener">scipec.vercel.app</a></div></div>`
  const name = user.full_name || user.email.split('@')[0]
  document.getElementById('topbar').innerHTML = `<div class="d-flex align-items-center gap-3 px-3 py-2">
    <button class="icon-btn" id="menuBtn" type="button" aria-controls="sidebar" aria-expanded="true" aria-label="Toggle menu">${icon('menu')}</button>
    <div class="flex-grow-1 min-w-0"><h1 class="fs-5 m-0 text-truncate">${esc(dataset.title)}</h1></div>
    ${can('reconcile:read') ? `<a class="icon-btn" href="cases.html" id="bell" aria-label="Open reconciliation cases">${icon('bell')}</a>` : ''}
    <div class="dropdown"><button class="btn p-0 d-flex align-items-center gap-2 border-0" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Account menu"><span class="avatar" aria-hidden="true">${esc(name.slice(0, 2).toUpperCase())}</span>
      <span class="text-start d-none d-md-block lh-sm"><span class="d-block small fw-semibold">${esc(name)}</span><span class="d-block small text-muted">${esc(user.role.replace(/_/g, ' '))}</span></span></button>
      <ul class="dropdown-menu dropdown-menu-end"><li><span class="dropdown-item-text small">${esc(user.email)}</span></li><li><hr class="dropdown-divider"></li>
      <li><button class="dropdown-item d-flex align-items-center gap-2" id="signOut" type="button">${icon('logout', 16)} Sign out</button></li></ul></div></div>`
  document.documentElement.classList.remove('app-pending')  // shell is drawn: reveal the page content
  setTheme(document.documentElement.getAttribute('data-bs-theme') || 'light')
  document.getElementById('themeBtn').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark'))
  document.getElementById('signOut').addEventListener('click', logout)
  // Hamburger: collapses the sidebar to icons on desktop, opens/closes the drawer on small screens.
  const menu = document.getElementById('menuBtn'), root = document.documentElement
  const sync = () => menu.setAttribute('aria-expanded', String(matchMedia('(min-width:992px)').matches ? !root.classList.contains('sb-collapsed') : document.getElementById('sidebar').classList.contains('show')))
  menu.addEventListener('click', () => {
    if (matchMedia('(min-width:992px)').matches) { root.classList.toggle('sb-collapsed'); localStorage.setItem('scipec.sidebar', root.classList.contains('sb-collapsed') ? 'collapsed' : 'open') }
    else window.bootstrap.Offcanvas.getOrCreateInstance('#sidebar').toggle()
    setTimeout(sync, 350)
  })
  sync()
  if (can('reconcile:read')) {
    const paint = k => {
      const b = document.getElementById('bell')
      b.querySelector('.dot')?.remove()
      if (!k) return b.setAttribute('aria-label', 'Open reconciliation cases')
      b.insertAdjacentHTML('beforeend', `<span class="dot">${k > 99 ? '99+' : k}</span>`)
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
