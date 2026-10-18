import { currentUser, login } from './auth.js'
import { bindForm } from './components.js'

const params = new URLSearchParams(location.search)
const safeNext = n => (n && /^[a-z]+\.html$/.test(n) ? n : 'dashboard.html')  // never redirect to arbitrary URLs
if (currentUser()) location.replace(safeNext(params.get('next')))
if (params.get('expired')) { const n = document.getElementById('notice'); n.textContent = 'Your session expired. Sign in again.'; n.classList.remove('d-none') }

const form = document.getElementById('loginForm')
const pw = document.getElementById('password')
document.getElementById('togglePw').addEventListener('click', e => {
  const show = pw.type === 'password'
  pw.type = show ? 'text' : 'password'
  e.currentTarget.textContent = show ? 'Hide' : 'Show'
  e.currentTarget.setAttribute('aria-pressed', String(show))
})
bindForm(form, async () => {
  await login(form.email.value.trim(), pw.value)
  location.assign(safeNext(params.get('next')))
})
