# SCIPEC Operations Platform: engineering notes

## Architecture
```
Browser (React + Vite)  --HTTPS/JSON, Bearer JWT-->  FastAPI  -->  PostgreSQL (source of truth)
   login, role-aware nav                              routers (thin) -> services (rules + transactions)
   records / deliveries / cases                       schemas (Pydantic) · analytics (pandas, read-only)
   import preview                                     errors + correlation ids · security (RBAC)
```
Request path of every write: authenticate -> authorize (`require(permission)`) -> validate (Pydantic) ->
`services.run()` opens one transaction containing the business rows, the audit event and the idempotency record -> commit -> respond.
Success is reported only after the commit returns.

## Operational chain and variance conventions
Harvested -> collected -> dispatched (delivery) -> factory receipt -> processed -> palm oil. Each quantity is its own column.
* Field balance: `left_in_field = harvested - collected` (derived server-side). A reason is required when > 0.
* Delivery variance: `received - dispatched` (negative = shrinkage). A case opens when `|variance| > VARIANCE_TONNES`.
* Daily view (`/reports/reconciliation`): transported vs received over a 2-day window; a separate report from delivery cases.
* Yield (OER) = oil / processed x 100, only where processed > 0. Missing data stays NULL and is reported as "missing", never as 0.
* Reports count submitted and approved records. Drafts are excluded.

## ACID decisions
| Property | Mechanism |
|---|---|
| Atomicity | one transaction per operation (record + audit + idempotency); imports are all-or-nothing |
| Consistency | FK, unique and CHECK constraints in PostgreSQL (non-negative, collected <= harvested, transported <= collected, downtime 0-24, receipt >= dispatch); NUMERIC(14,3) quantities, Decimal arithmetic |
| Isolation | row locks (`SELECT ... FOR UPDATE`) on state transitions, optimistic `version` on editable rows (409 `version_conflict`) |
| Durability | PostgreSQL commit before response; backups below |
| Idempotency | `Idempotency-Key` header on creates/receipts/imports: same key + same payload replays the stored response; different payload -> 422 |

## Role-permission matrix (generated from `app/security.py`)
| Permission | admin | operations manager | field supervisor | factory operator | reconciliation officer | auditor |
|---|---|---|---|---|---|---|
| `fruit:read` | yes | yes | yes | – | yes | yes |
| `fruit:write` | yes | – | yes | – | – | – |
| `fruit:submit` | yes | – | yes | – | – | – |
| `fruit:approve` | yes | yes | – | – | – | – |
| `factory:read` | yes | yes | – | yes | yes | yes |
| `factory:write` | yes | – | – | yes | – | – |
| `delivery:read` | yes | yes | yes | yes | yes | yes |
| `delivery:dispatch` | yes | – | yes | – | – | – |
| `delivery:receive` | yes | – | – | yes | – | – |
| `reconcile:read` | yes | yes | – | – | yes | yes |
| `reconcile:resolve` | yes | – | – | – | yes | – |
| `report:read` | yes | yes | yes | yes | yes | yes |
| `import:write` | yes | yes | – | – | – | – |
| `audit:read` | yes | yes | – | – | – | yes |

Permissions are enforced by the API. The UI only hides controls. Every query is filtered by the caller's organization.

## API usage
`POST /api/v1/auth/login` -> `access_token` (15 min) + `refresh_token` (7 days); send `Authorization: Bearer ...`.
Lists are paginated (`page`, `page_size<=200`, `sort`, filters) and return `{items,total,page,page_size}`.
Errors: `{"error": {"code","message","details","correlation_id"}}`. Codes: `validation_error`, `duplicate_record`, `version_conflict`,
`not_editable`, `four_eyes`, `invalid_state`, `idempotency_conflict`, `duplicate_reference`, `receipt_before_dispatch`, `already_received`,
`already_resolved`, `import_rejected`, `forbidden`, `not_authenticated`, `invalid_credentials`, `too_many_attempts`, `internal_error`.
Interactive docs: `/docs`. Health: `/health/live`, `/health/ready`.

## Environment variables
See `backend/.env.example` and `.env.example.compose`. `JWT_SECRET` (32+ chars) is mandatory; the API refuses to start without it.

## Run
```
cp .env.example.compose .env   # set POSTGRES_PASSWORD, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD (12+ chars)
docker compose up --build       # db -> migrate (alembic + seed) -> api (:8000) -> web (:8080)
```
Without Docker: `cd backend && alembic upgrade head && ADMIN_EMAIL=... ADMIN_PASSWORD=... python -m app.seed && uvicorn app.main:app`.
Tests: `TEST_DATABASE_URL=postgresql+psycopg://... pytest -q` (concurrency tests need PostgreSQL and are skipped on SQLite).
Existing development databases created with `create_all` have no migration history: dump the data, create a fresh database with `alembic upgrade head`, then reload.

## Deploy and roll back
1. Back up (`pg_dump -Fc`). 2. Build new images. 3. Run `alembic upgrade head` (one-shot job). 4. Roll out the API, then the web app.
Rollback: redeploy the previous images. If the migration must be undone and no new data depends on it, `alembic downgrade -1`; otherwise restore the backup.
Never run `create_all` in production (`AUTO_CREATE` is for tests only).

## Backup and restore
```
pg_dump -Fc "$DATABASE_URL_PLAIN" > ops-$(date +%F).dump          # daily, keep 30 days, copy off-host
createdb ops_restore && pg_restore -d ops_restore ops-YYYY-MM-DD.dump  # restore drill: run monthly, then run /health/ready checks against it
```
For point-in-time recovery enable WAL archiving on your PostgreSQL host. Durability depends on that host's fsync and storage settings.

## Troubleshooting
* API exits at start: `JWT_SECRET` missing or short. * 401 after a while: access token expired and refresh failed; sign in again.
* 409 `version_conflict`: reload the record. * Import rejected: the response lists every bad row; nothing was saved.
* Browser CORS error: add the web origin to `CORS_ORIGINS`.
