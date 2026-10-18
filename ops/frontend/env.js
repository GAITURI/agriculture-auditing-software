// Runtime configuration (loaded before the app, never bundled, never cached for long).
// apiBase '' = same origin: the dev server and nginx forward /api to the backend, so the browser needs no CORS preflights.
// Use a full URL only when the API lives on another origin (then enable CORS on it).
window.SCIPEC_CONFIG = { apiBase: '' }
