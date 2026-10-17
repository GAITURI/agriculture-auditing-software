import datetime as dt
import hashlib
import time
from io import BytesIO

import pandas as pd
from fastapi import APIRouter, Depends, File, Header, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import analytics, config as C, services as S
from .database import get_db
from .errors import AppError
from .models import AuditEvent, Block, Delivery, FactoryProduction, FruitCollection, ReconciliationCase, User
from .schemas import DeliveryIn, FactoryIn, FruitIn, FruitPatch, LoginIn, ReceiptIn, RefreshIn, ResolveIn
from .security import DUMMY, PERMISSIONS, allowed, current_user, decode, make_token, require, verify_password

router = APIRouter(prefix="/api/v1")
Key = Header(None, alias="Idempotency-Key", max_length=80)
Page = lambda: Query(1, ge=1)
Size = lambda: Query(50, ge=1, le=200)


def reply(res):
    return JSONResponse(res[1], res[0])


def _rng(start, end):
    start, end = start or C.CYCLE_START, end or C.CYCLE_END
    if start > end:
        raise AppError(422, "invalid_range", "start must be on or before end")
    return start, end


# ---------- auth ----------
_fails: dict = {}  # per-process throttle; use a shared store (Redis) when running several API workers


def _user_out(u):
    perms = sorted(PERMISSIONS[u.role]) if u.role in PERMISSIONS else []
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "org_id": u.org_id, "permissions": perms}


@router.post("/auth/login")
def login(p: LoginIn, db: Session = Depends(get_db)):
    k = p.email.lower()
    n, t0 = _fails.get(k, (0, time.time()))
    if time.time() - t0 > 300:
        n, t0 = 0, time.time()
    if n >= 5:
        raise AppError(429, "too_many_attempts", "Too many failed sign-ins. Try again in a few minutes.")
    u = db.scalar(select(User).where(func.lower(User.email) == k))
    ok = verify_password(p.password, u.password_hash if u else DUMMY)
    if not (u and ok and u.is_active):
        _fails[k] = (n + 1, t0)
        raise AppError(401, "invalid_credentials", "Email or password is incorrect.")
    _fails.pop(k, None)
    return {"access_token": make_token(u, "access"), "refresh_token": make_token(u, "refresh"), "token_type": "bearer", "user": _user_out(u)}


@router.post("/auth/refresh")
def refresh(p: RefreshIn, db: Session = Depends(get_db)):
    u = db.get(User, decode(p.refresh_token, "refresh"))
    if not u or not u.is_active:
        raise AppError(401, "invalid_token", "Account not found or disabled.")
    return {"access_token": make_token(u, "access"), "refresh_token": make_token(u, "refresh"), "token_type": "bearer"}


@router.get("/auth/me")
def me(u: User = Depends(current_user)):
    return _user_out(u)


@router.get("/config")
def config(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"cycle_start": C.CYCLE_START, "cycle_end": C.CYCLE_END, "blocks": analytics.blocks(db, u.org_id),
            "variance_tonnes": float(C.VARIANCE_T), "oer_min": C.OER_MIN, "oer_max": C.OER_MAX}


@router.get("/blocks")
def blocks(u: User = Depends(current_user), db: Session = Depends(get_db)):
    return analytics.blocks(db, u.org_id)


# ---------- fruit collection ----------
@router.get("/fruit-collection")
def list_fruit(start: dt.date | None = None, end: dt.date | None = None, block: str | None = None, status: str | None = None,
               sort: str = Query("-date", pattern="^-?(date|status|block|harvested|collected)$"),
               page: int = Page(), page_size: int = Size(), u: User = Depends(require("fruit:read")), db: Session = Depends(get_db)):
    start, end = _rng(start, end)
    q = S.fruit_query(u).where(FruitCollection.date.between(start, end))
    if block:
        q = q.where(Block.name == block)
    if status:
        q = q.where(FruitCollection.status == status)
    col = {"date": FruitCollection.date, "status": FruitCollection.status, "block": Block.name,
           "harvested": FruitCollection.harvested, "collected": FruitCollection.collected}[sort.lstrip("-")]
    q = q.order_by(col.desc() if sort.startswith("-") else col.asc(), FruitCollection.id)
    return S.paginate(db, q, page, page_size, S.fruit_out)


@router.post("/fruit-collection", status_code=201)
def create_fruit(p: FruitIn, key: str | None = Key, u: User = Depends(require("fruit:write")), db: Session = Depends(get_db)):
    return reply(S.run(db, u, key, p.model_dump(mode="json"), lambda: S.create_fruit(db, u, p), 201))


@router.get("/fruit-collection/{id}")
def get_fruit(id: int, u: User = Depends(require("fruit:read")), db: Session = Depends(get_db)):
    return S.fruit_out(*S.get_fruit(db, u, id))


@router.patch("/fruit-collection/{id}")
def patch_fruit(id: int, p: FruitPatch, u: User = Depends(require("fruit:write")), db: Session = Depends(get_db)):
    return reply(S.run(db, u, None, None, lambda: S.patch_fruit(db, u, id, p)))


@router.post("/fruit-collection/{id}/submit")
def submit_fruit(id: int, u: User = Depends(require("fruit:submit")), db: Session = Depends(get_db)):
    return reply(S.run(db, u, None, None, lambda: S.transition_fruit(db, u, id, "submit")))


@router.post("/fruit-collection/{id}/approve")
def approve_fruit(id: int, u: User = Depends(require("fruit:approve")), db: Session = Depends(get_db)):
    return reply(S.run(db, u, None, None, lambda: S.transition_fruit(db, u, id, "approve")))


# ---------- factory ----------
@router.post("/factory-production")
def save_factory(p: FactoryIn, key: str | None = Key, u: User = Depends(require("factory:write")), db: Session = Depends(get_db)):
    """Upsert by date. Every change is audited with before/after values."""
    return reply(S.run(db, u, key, p.model_dump(mode="json"), lambda: S.upsert_factory(db, u, p)))


@router.get("/factory-production")
def list_factory(start: dt.date | None = None, end: dt.date | None = None, page: int = Page(), page_size: int = Size(),
                 u: User = Depends(require("factory:read")), db: Session = Depends(get_db)):
    start, end = _rng(start, end)
    q = select(FactoryProduction).where(FactoryProduction.org_id == u.org_id, FactoryProduction.date.between(start, end)).order_by(FactoryProduction.date)
    return S.paginate(db, q, page, page_size, lambda r: {"id": r.id, "date": r.date.isoformat(), "total_received": r.total_received and float(r.total_received),
                      "processed": r.processed and float(r.processed), "oil": r.oil and float(r.oil), "downtime": r.downtime and float(r.downtime), "version": r.version})


# ---------- deliveries + delivery-level reconciliation ----------
@router.get("/deliveries")
def list_deliveries(status: str | None = None, page: int = Page(), page_size: int = Size(),
                    u: User = Depends(require("delivery:read")), db: Session = Depends(get_db)):
    q = (select(Delivery, Block.name).join(Block, Block.id == Delivery.block_id).where(Delivery.org_id == u.org_id)
         .order_by(Delivery.dispatched_at.desc(), Delivery.id))
    if status:
        q = q.where(Delivery.status == status)
    return S.paginate(db, q, page, page_size, S.delivery_out)


@router.post("/deliveries", status_code=201)
def dispatch(p: DeliveryIn, key: str | None = Key, u: User = Depends(require("delivery:dispatch")), db: Session = Depends(get_db)):
    return reply(S.run(db, u, key, p.model_dump(mode="json"), lambda: S.create_delivery(db, u, p), 201))


@router.post("/deliveries/{id}/receipt")
def receipt(id: int, p: ReceiptIn, key: str | None = Key, u: User = Depends(require("delivery:receive")), db: Session = Depends(get_db)):
    return reply(S.run(db, u, key, {"id": id, **p.model_dump(mode="json")}, lambda: S.receive_delivery(db, u, id, p)))


@router.get("/reconciliation")
def list_cases(status: str | None = Query(None, pattern="^(open|resolved)$"), page: int = Page(), page_size: int = Size(),
               u: User = Depends(require("reconcile:read")), db: Session = Depends(get_db)):
    q = (select(ReconciliationCase, Delivery.reference).join(Delivery, Delivery.id == ReconciliationCase.delivery_id)
         .where(ReconciliationCase.org_id == u.org_id).order_by(ReconciliationCase.status.desc(), ReconciliationCase.id.desc()))
    if status:
        q = q.where(ReconciliationCase.status == status)
    return S.paginate(db, q, page, page_size, S.case_out)


@router.get("/reconciliation/{id}")
def get_case(id: int, u: User = Depends(require("reconcile:read")), db: Session = Depends(get_db)):
    r = db.execute(select(ReconciliationCase, Delivery.reference).join(Delivery, Delivery.id == ReconciliationCase.delivery_id)
                   .where(ReconciliationCase.id == id, ReconciliationCase.org_id == u.org_id)).first()
    if not r:
        raise AppError(404, "not_found", "Case not found.")
    hist = db.scalars(select(AuditEvent).where(AuditEvent.entity == "reconciliation_case", AuditEvent.entity_id == str(id), AuditEvent.org_id == u.org_id).order_by(AuditEvent.id))
    return {**S.case_out(*r), "history": [{"at": h.at.isoformat(), "actor_id": h.actor_id, "action": h.action, "reason": h.reason} for h in hist]}


@router.post("/reconciliation/{id}/resolve")
def resolve(id: int, p: ResolveIn, u: User = Depends(require("reconcile:resolve")), db: Session = Depends(get_db)):
    return reply(S.run(db, u, None, None, lambda: S.resolve_case(db, u, id, p)))


# ---------- reports (daily aggregate view; distinct from delivery-level cases above) ----------
@router.get("/dashboard/summary")
@router.get("/reports/summary")
def r_summary(start: dt.date | None = None, end: dt.date | None = None, u: User = Depends(require("report:read")), db: Session = Depends(get_db)):
    s = analytics.summary(db, u.org_id, *_rng(start, end))
    s["open_cases"] = db.scalar(select(func.count()).select_from(ReconciliationCase).where(ReconciliationCase.org_id == u.org_id, ReconciliationCase.status == "open"))
    s["generated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    return s


@router.get("/dashboard/timeseries")
@router.get("/reports/timeseries")
def r_series(start: dt.date | None = None, end: dt.date | None = None, freq: str = Query("D", pattern="^[DWMY]$"),
             u: User = Depends(require("report:read")), db: Session = Depends(get_db)):
    return analytics.timeseries(db, u.org_id, *_rng(start, end), freq)


@router.get("/reports/monthly")
def r_monthly(start: dt.date | None = None, end: dt.date | None = None, u: User = Depends(require("report:read")), db: Session = Depends(get_db)):
    return analytics.timeseries(db, u.org_id, *_rng(start, end), "M")


@router.get("/reports/reconciliation")
def r_daily_recon(start: dt.date | None = None, end: dt.date | None = None, u: User = Depends(require("report:read")), db: Session = Depends(get_db)):
    return analytics.records(analytics.with_metrics(analytics.daily(db, u.org_id, *_rng(start, end))))


@router.get("/reports/operational-variance")
def r_variance(u: User = Depends(require("reconcile:read")), db: Session = Depends(get_db)):
    q = select(ReconciliationCase.status, func.count(), func.coalesce(func.sum(ReconciliationCase.variance), 0)).where(
        ReconciliationCase.org_id == u.org_id).group_by(ReconciliationCase.status)
    return [{"status": s, "cases": n, "net_variance_t": float(v)} for s, n, v in db.execute(q)]


@router.get("/audit")
def audit_log(entity: str | None = None, entity_id: str | None = None, page: int = Page(), page_size: int = Size(),
              u: User = Depends(require("audit:read")), db: Session = Depends(get_db)):
    q = select(AuditEvent).where(AuditEvent.org_id == u.org_id).order_by(AuditEvent.id.desc())
    if entity:
        q = q.where(AuditEvent.entity == entity)
    if entity_id:
        q = q.where(AuditEvent.entity_id == entity_id)
    return S.paginate(db, q, page, page_size, lambda a: {"id": a.id, "at": a.at.isoformat(), "actor_id": a.actor_id, "entity": a.entity, "entity_id": a.entity_id,
                      "action": a.action, "reason": a.reason, "correlation_id": a.correlation_id, "before": a.before, "after": a.after})


# ---------- Excel import: validated preview, then atomic commit (drafts only; submitted/approved are never overwritten) ----------
FRUIT_COLS = ["date", "block", "harvested", "collected", "transported", "harvesters", "collectors", "left", "reason", "remarks"]
FACT_COLS = ["date", "ffb_banakanuke", "ffb_batchepo", "ffb_bakilo", "total_received", "processed", "oil", "yield", "downtime", "remarks"]


def _clean(v):
    if v is None or (not isinstance(v, str) and pd.isna(v)):
        return None
    return (v.strip() or None) if isinstance(v, str) else v


def _read(content):
    xl = pd.ExcelFile(BytesIO(content))
    fc, fp = xl.parse("Fruit Collection", header=3), xl.parse("Factory Production", header=3)
    fc.columns, fp.columns = FRUIT_COLS, FACT_COLS
    fc["xl_row"], fp["xl_row"] = fc.index + 5, fp.index + 5
    return fc[fc["block"].astype(str).str.upper() != "DAILY TOTAL"], fp


def _plan(sheet, df, fields, Model, existing, key_of, mode, blocks=None):
    items, errors = [], []
    for _, r in df.iterrows():
        prov = {k: v for k, v in ((f, _clean(r[f])) for f in fields) if v is not None}
        if not any(k not in ("reason", "remarks") for k in prov):
            continue
        d = pd.to_datetime(r["date"], errors="coerce")
        d = None if pd.isna(d) else d.date()
        cur = existing.get(key_of(d, r))
        err = lambda m: errors.append({"sheet": sheet, "row": int(r["xl_row"]), "errors": m})
        if cur and cur.get("_status", "draft") != "draft":
            err([f"record is {cur['_status']} and cannot be overwritten by an import"])
            continue
        if blocks is not None and str(r["block"]).strip() not in blocks:
            err([f"block: '{r['block']}' does not exist for your organization"])
            continue
        data = {**({k: v for k, v in cur.items() if not k.startswith("_")} if cur and mode == "merge" else {}), **prov, "date": d,
                **({"block": str(r["block"]).strip()} if "block" in r else {})}
        try:
            model = Model(**data)
        except ValidationError as e:
            err([f"{'.'.join(map(str, x['loc'])) or 'row'}: {x['msg']}" for x in e.errors()])
            continue
        cleared = [f for f in fields if mode == "replace" and cur and cur.get(f) is not None and f not in prov]
        items.append({"sheet": sheet, "row": int(r["xl_row"]), "action": "update" if cur else "insert", "cleared": cleared, "model": model})
    return items, errors


def _apply(db, u, items, sha):
    for i in items:
        m = i["model"]
        if i["sheet"] == "Fruit Collection":
            bid = S.block_id(db, u, m.block)
            row = db.scalar(select(FruitCollection).where(FruitCollection.date == m.date, FruitCollection.block_id == bid).with_for_update())
            if row is None:
                S.create_fruit(db, u, m)
            else:
                before = S.snap(row, S.FRUIT_FIELDS)
                for f in S.FRUIT_FIELDS:
                    setattr(row, f, getattr(m, f))
                row.left_in_field = m.left
                S.audit(db, u, "fruit_collection", row.id, "import_update", before, S.snap(row, S.FRUIT_FIELDS), f"import {sha[:12]}")
        else:
            S.upsert_factory(db, u, m)
    S.audit(db, u, "import", sha[:12], "commit", after={"rows": len(items), "sha256": sha})


@router.post("/import")
async def import_workbook(file: UploadFile = File(...), commit: bool = False, mode: str = Query("merge", pattern="^(merge|replace)$"),
                          key: str | None = Key, u: User = Depends(require("import:write")), db: Session = Depends(get_db)):
    content = await file.read(C.MAX_UPLOAD_BYTES + 1)
    if len(content) > C.MAX_UPLOAD_BYTES:
        raise AppError(413, "file_too_large", f"Workbook exceeds {C.MAX_UPLOAD_BYTES // 1024 // 1024} MB.")
    if not (file.filename or "").lower().endswith(".xlsx") or content[:2] != b"PK":
        raise AppError(415, "unsupported_file", "Upload an .xlsx workbook.")
    sha = hashlib.sha256(content).hexdigest()
    try:
        fc, fp = _read(content)
    except Exception:
        raise AppError(400, "bad_workbook", "Could not read the workbook. It needs sheets 'Fruit Collection' and 'Factory Production' with headers on row 4.")
    names = set(analytics.blocks(db, u.org_id))
    ex_f = {(r.date, n): {**{f: getattr(r, f) for f in S.FRUIT_FIELDS}, "_status": r.status} for r, n in db.execute(S.fruit_query(u))}
    ex_p = {r.date: {f: getattr(r, f) for f in S.FACT_FIELDS} for r in db.scalars(select(FactoryProduction).where(FactoryProduction.org_id == u.org_id))}
    a, ea = _plan("Fruit Collection", fc, S.FRUIT_FIELDS, FruitIn, ex_f, lambda d, r: (d, str(r["block"]).strip()), mode, names)
    b, eb = _plan("Factory Production", fp, S.FACT_FIELDS, FactoryIn, ex_p, lambda d, r: d, mode)
    errors, items = ea + eb, a + b
    report = {"committed": False, "mode": mode, "sha256": sha, "errors": errors,
              "inserts": sum(i["action"] == "insert" for i in items), "updates": sum(i["action"] == "update" for i in items),
              "cleared_cells": [{"sheet": i["sheet"], "row": i["row"], "fields": i["cleared"]} for i in items if i["cleared"]],
              "warnings": [{"row": i["row"], "messages": i["model"].warnings()} for i in items if i["sheet"] == "Factory Production" and i["model"].warnings()]}
    if not commit:
        return report
    if errors:
        raise AppError(422, "import_rejected", f"Import rejected: {len(errors)} invalid row(s). Nothing was saved.", report)

    def go():
        _apply(db, u, items, sha)
        return {**report, "committed": True}
    return reply(S.run(db, u, key, {"sha": sha, "mode": mode}, go))
