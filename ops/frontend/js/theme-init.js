// Classic (non-module) script loaded in <head> so the saved theme is applied before first paint (no flash).
(function () {
  var t = localStorage.getItem('scipec.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  document.documentElement.setAttribute('data-bs-theme', t)
  if (localStorage.getItem('scipec.sidebar') === 'collapsed') document.documentElement.classList.add('sb-collapsed')
  document.documentElement.classList.add('app-pending')  // hides page content until the shell (menu, top bar) is drawn
  setTimeout(function () { document.documentElement.classList.remove('app-pending') }, 4000)  // safety net: never stay blank
})()
