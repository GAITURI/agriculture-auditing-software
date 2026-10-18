# Frontend migration report: React -> HTML + Bootstrap + Tailwind + vanilla JS

## Removed
`react`, `react-dom`, `recharts`, `vite`, `@vitejs/plugin-react`; `src/App.jsx`, `src/Workflow.jsx`, `src/main.jsx`, `src/api.js`, `src/styles.css`, `vite.config.js`, `index.html` (Vite entry), `.env.example` (`VITE_API_BASE_URL`; the API address is now `js/config.js`).
Remaining dependencies: `bootstrap` (runtime assets); `tailwindcss`, `http-server` (dev only).

## Preserved (backend)
No route, model, migration, permission or test was changed. One configuration default changed: `CORS_ORIGINS` now also allows `http://127.0.0.1:5173` (the local frontend origin). Nothing was weakened.

## Feature mapping
| React screen | HTML page | Notes |
|---|---|---|
| Login | login.html | show/hide password, 401/429 messages, safe `next` redirect |
| Overview | dashboard.html | KPI cards, SVG chart (replaces Recharts), open cases, recent activity (audit:read only) |
| Field entry + Field records | records.html | create/edit draft (modal), submit, approve with confirmation, filters, server pagination |
| Factory entry | factory.html | list + record production day, backend warnings shown |
| Deliveries | deliveries.html | dispatch and receipt modals, idempotency keys |
| Cases | cases.html | resolve with required explanation |
| Daily reconciliation | reconciliation.html | day strip (symbols + text, not colour only), CSV export |
| Import workbook | import.html | preview, replace-mode confirmation, row errors |

## Not built, because the backend has no matching endpoints
Users, Organizations, Inventory, Settings, payroll/stipend reports. No placeholder pages were added; each needs backend routes first.

## Test report
Run in a sandbox against PostgreSQL 16, the real FastAPI app and the static server.
**Passed (28 checks, `frontend/tests/integration.mjs`)**: all 9 HTML pages and their CSS/JS assets load; no inline scripts or handlers; no React in the source; `esc()` escapes HTML; wrong password message; rate-limit (429) message; login stores session and permissions; bearer token sent; expired access token refreshed transparently; unrecoverable session clears storage and redirects to `login.html?expired=1`; logout; missing session handling; 403 for an unauthorised role; idempotent create (same key -> one record); readable validation errors; stale PATCH -> `version_conflict`; submit and approve by a second user; dashboard excludes drafts; dispatch -> short receipt -> case -> resolve; multipart import preview and commit; non-xlsx rejected; unreachable API gives a friendly error.
**Backend regression**: 18/18 pytest tests pass on PostgreSQL; ruff passes. Migration up/down/up verified earlier.
**CORS**: preflight from `http://127.0.0.1:5173` allowed.

**Not tested (be aware)**: the pages were never rendered in a real browser here, so these are unverified: visual layout and responsiveness (desktop/tablet/mobile), the sidebar offcanvas, modals, toasts, the SVG chart's appearance, keyboard navigation and focus order, contrast, and the browser console. The DOM scripts (`records.js`, `dashboard.js`, etc.) passed a syntax check and were exercised only through the API layer they call. Also untested: Windows itself, Docker/compose, the CI workflow, and the import screen with a large file. Please click through each page once after starting the servers.
