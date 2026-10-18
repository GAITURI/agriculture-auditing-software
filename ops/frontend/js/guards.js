// Frontend guards only improve navigation. The API enforces every permission; never rely on these for security.
import { can, currentUser } from './auth.js'

export function guard(permission) {
  const user = currentUser()
  if (!user) {
    const next = encodeURIComponent(window.location.pathname.split('/').pop() || 'dashboard.html')
    window.location.replace(`login.html?next=${next}`)
    return null
  }
  if (permission && !can(permission)) return { user, denied: true }
  return { user, denied: false }
}
