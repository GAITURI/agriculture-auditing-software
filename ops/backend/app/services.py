"""Business workflows. Every write = one transaction: business rows + audit event + idempotency record."""
import datetime as dt
import hashlib
import json
from decimal import Decimal

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from . import config as C
from .errors import AppError, correlation_id
from .models import (AuditEvent, Block, Delivery, FactoryProduction, FruitCollection, IdempotencyKey,
                     ReconciliationCase, Site, User, utcnow)
from .schemas import FactoryIn, FruitIn

FRUIT_FIELDS = ["harvested", "collected", "transported", "harvesters", "collectors", "reason", "remarks"]
FACT_FIELDS = ["ffb_banakanuke", "ffb_batchepo", "ffb_bakilo", "processed", "oil", "downtime", "remarks"]


def _j(v):
    return str(v) if isinstance(v, Decimal) else v.isoformat() if isinstance(v, (dt.date, dt.datetime)) else v


def snap(row, fields):
    return {f: _j(getattr(row, f)) for f in fields}


def audit(db: Session, user: User, entity, entity_id, action, before=None, after=None, reason=None):
    db.add(AuditEvent(org_id=user.org_id, actor_id=user.id, entity=entity, entity_id=str(entity_id), action=action,
                      reason=reason, correlation_id=correlation_id.get(), before=before, after=after))


# ---------- idempotency + commit wrapper ----------
def _hash(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def _lookup(db, user, key, h):
    row = db.scalar(select(IdempotencyKey).where(IdempotencyKey.user_id == user.id, IdempotencyKey.key == key))
    if row is None:
        return None
    if row.request_hash != h:
        raise AppError(422, "idempotency_conflict", "This Idempotency-Key was already used with a different request.")
    return row.status_code, row.response


def run(db: Session, user: User, key: str | None, payload, fn, status=200):
    """Execute fn() and commit atomically. A repeated key replays the stored response without re-executing."""
    h = _hash(payload) if key else None
    if key and (hit := _lookup(db, user, key, h)):
        return hit
    try:
        body = fn()
        if key:
            db.add(IdempotencyKey(user_id=user.id, key=key, request_hash=h, status_code=status, response=json.loads(json.dumps(body, default=str))))
        db.commit()  # success is reported only after this returns
    except AppError:
        db.rollback()
        if key and (hit := _lookup(db, user, key, h)):  # lost a race against an identical in-flight request
            return hit
        raise
    except StaleDataError:
        db.rollback()
        raise AppError(409, "version_conflict", "This record was changed by someone else. Reload and try again.")
    except IntegrityError:
        db.rollback()
        if key and (hit := _lookup(db, user, key, h)):  # concurrent duplicate of the same request
            return hit
        raise AppError(409, "conflict", "This record already exists or conflicts with existing data.")
    except Exception:
        db.rollback()
        raise
    return status, body


# ---------- scoping helpers (tenant boundary enforced in every query) ----------
def block_id(db, user, name):
    bid = db.scalar(select(Block.id).join(Site, Site.id == Block.site_id)
                    .where(Site.org_id == user.org_id, Block.name == name, Block.is_active))
    if bid is None:
        raise AppError(422, "unknown_block", f"Block '{name}' does not exist for your organization.")
    return bid


def fruit_query(user):
    return (select(FruitCollection, Block.name).join(Block, Block.id == FruitCollection.block_id)
            .join(Site, Site.id == Block.site_id).where(Site.org_id == user.org_id))


def get_fruit(db, user, id_, lock=False):
    q = fruit_query(user).where(FruitCollection.id == id_)
    if lock:
        q = q.with_for_update(of=FruitCollection)
    r = db.execute(q).first()
    if r is None:
        raise AppError(404, "not_found", "Record not found.")  # same answer for 'other tenant' and 'missing'
    return r


def fruit_out(r, block):
    f = lambda v: None if v is None else float(v)
    return {"id": r.id, "date": r.date.isoformat(), "block": block, "status": r.status, "version": r.version,
            "harvested": f(r.harvested), "collected": f(r.collected), "transported": f(r.transported),
            "harvesters": r.harvesters, "collectors": r.collectors, "left_in_field": f(r.left_in_field),
            "reason": r.reason, "remarks": r.remarks, "created_by": r.created_by,
            "approved_by": r.approved_by, "approved_at": r.approved_at and r.approved_at.isoformat()}


def _validate(Model, data):
    try:
        return Model(**data)
    except ValidationError as e:
        d = [{"field": ".".join(map(str, x["loc"])) or "record", "message": x["msg"].replace("Value error, ", "")} for x in e.errors()]
        raise AppError(422, "validation_error", "; ".join(f"{x['field']}: {x['message']}" for x in d), d)


# ---------- fruit workflow: draft -> submitted -> approved ----------
def create_fruit(db, user, p: FruitIn):
    bid = block_id(db, user, p.block)
    if db.scalar(select(FruitCollection.id).where(FruitCollection.date == p.date, FruitCollection.block_id == bid)):
        raise AppError(409, "duplicate_record", f"A record for {p.block} on {p.date} already exists. Edit it instead.")
    row = FruitCollection(date=p.date, block_id=bid, status="draft", created_by=user.id,
                          left_in_field=p.left, **{f: getattr(p, f) for f in FRUIT_FIELDS})
    db.add(row)
    db.flush()
    audit(db, user, "fruit_collection", row.id, "create", after=snap(row, FRUIT_FIELDS + ["status", "date"]))
    return fruit_out(row, p.block)


def patch_fruit(db, user, id_, patch):
    row, bname = get_fruit(db, user, id_, lock=True)
    if row.status != "draft":
        raise AppError(409, "not_editable", f"A {row.status} record cannot be edited. Corrections need a new revision.")
    if patch.version != row.version:
        raise AppError(409, "version_conflict", "This record was changed by someone else. Reload and try again.")
    before = snap(row, FRUIT_FIELDS)
    data = {**{f: getattr(row, f) for f in FRUIT_FIELDS}, "date": row.date, "block": bname}
    given = patch.model_fields_set
    for f in ("harvested", "collected", "transported", "harvesters", "collectors", "remarks"):
        if f in given:
            data[f] = getattr(patch, f)
    if "shortfall_reason" in given:
        data["reason"] = patch.shortfall_reason
    p = _validate(FruitIn, data)
    for f in FRUIT_FIELDS:
        setattr(row, f, getattr(p, f))
    row.left_in_field, row.updated_at = p.left, utcnow()
    audit(db, user, "fruit_collection", row.id, "update", before, snap(row, FRUIT_FIELDS), patch.reason)
    db.flush()
    return fruit_out(row, bname)


def transition_fruit(db, user, id_, action):
    row, bname = get_fruit(db, user, id_, lock=True)
    src, dst = {"submit": ("draft", "submitted"), "approve": ("submitted", "approved")}[action]
    if row.status != src:
        raise AppError(409, "invalid_state", f"Only {src} records can be {action}ted." if action == "submit" else f"Only {src} records can be approved.")
    if action == "approve":
        if row.created_by == user.id:
            raise AppError(409, "four_eyes", "You cannot approve a record you created.")
        row.approved_by, row.approved_at = user.id, utcnow()
    row.status, row.updated_at = dst, utcnow()
    audit(db, user, "fruit_collection", row.id, action, {"status": src}, {"status": dst})
    db.flush()
    return fruit_out(row, bname)


# ---------- factory ----------
def upsert_factory(db, user, p: FactoryIn):
    row = db.scalar(select(FactoryProduction).where(FactoryProduction.org_id == user.org_id, FactoryProduction.date == p.date).with_for_update())
    before = snap(row, FACT_FIELDS) if row else None
    if row is None:
        row = FactoryProduction(org_id=user.org_id, date=p.date)
        db.add(row)
    for f in FACT_FIELDS:
        setattr(row, f, getattr(p, f))
    row.total_received, row.updated_by, row.updated_at = p.received, user.id, utcnow()
    db.flush()
    audit(db, user, "factory_production", row.id, "update" if before else "create", before, snap(row, FACT_FIELDS + ["total_received"]))
    f = lambda v: None if v is None else float(v)
    return {"record": {"id": row.id, "date": row.date.isoformat(), **{k: f(getattr(row, k)) for k in FACT_FIELDS if k != "remarks"},
                       "total_received": f(row.total_received), "remarks": row.remarks, "version": row.version},
            "warnings": p.warnings()}


# ---------- deliveries + delivery-level reconciliation ----------
def delivery_out(d, block):
    f = lambda v: None if v is None else float(v)
    return {"id": d.id, "reference": d.reference, "block": block, "vehicle": d.vehicle, "status": d.status,
            "dispatched_at": d.dispatched_at.isoformat(), "dispatched_qty": f(d.dispatched_qty),
            "received_at": d.received_at and d.received_at.isoformat(), "received_qty": f(d.received_qty),
            "weighbridge_ref": d.weighbridge_ref, "version": d.version}


def create_delivery(db, user, p):
    d = Delivery(org_id=user.org_id, reference=p.reference.strip(), block_id=block_id(db, user, p.block), vehicle=p.vehicle,
                 dispatched_at=p.dispatched_at, dispatched_qty=p.dispatched_qty, created_by=user.id)
    if db.scalar(select(Delivery.id).where(Delivery.org_id == user.org_id, Delivery.reference == d.reference)):
        raise AppError(409, "duplicate_reference", f"Delivery reference {d.reference} already exists.")
    db.add(d)
    db.flush()
    audit(db, user, "delivery", d.id, "dispatch", after=snap(d, ["reference", "dispatched_at", "dispatched_qty", "vehicle"]))
    return delivery_out(d, p.block)


def receive_delivery(db, user, id_, p):
    d = db.scalar(select(Delivery).where(Delivery.id == id_, Delivery.org_id == user.org_id).with_for_update())
    if d is None:
        raise AppError(404, "not_found", "Delivery not found.")
    if d.status == "received":
        raise AppError(409, "already_received", "This delivery already has a factory receipt.")
    sent = d.dispatched_at if d.dispatched_at.tzinfo else d.dispatched_at.replace(tzinfo=dt.timezone.utc)  # SQLite drops tzinfo
    if p.received_at < sent:
        raise AppError(422, "receipt_before_dispatch", "Receipt time cannot be earlier than dispatch time.")
    d.received_at, d.received_qty, d.weighbridge_ref, d.status = p.received_at, p.received_qty, p.weighbridge_ref, "received"
    variance = p.received_qty - d.dispatched_qty  # actual - expected; negative = shrinkage
    case = None
    if abs(variance) > Decimal(C.VARIANCE_T):
        case = ReconciliationCase(org_id=user.org_id, delivery_id=d.id, expected=d.dispatched_qty, actual=p.received_qty, variance=variance)
        db.add(case)
    db.flush()
    audit(db, user, "delivery", d.id, "receive", {"status": "in_transit"}, snap(d, ["received_at", "received_qty", "weighbridge_ref", "status"]))
    if case:
        audit(db, user, "reconciliation_case", case.id, "open", after={"variance": str(variance), "delivery": d.reference})
    bname = db.scalar(select(Block.name).where(Block.id == d.block_id))
    return {**delivery_out(d, bname), "variance": float(variance), "case_id": case.id if case else None}


def case_out(c, ref=None):
    return {"id": c.id, "delivery_id": c.delivery_id, "delivery_reference": ref, "expected": float(c.expected), "actual": float(c.actual),
            "variance": float(c.variance), "status": c.status, "resolution_reason": c.resolution_reason,
            "resolved_by": c.resolved_by, "resolved_at": c.resolved_at and c.resolved_at.isoformat(), "version": c.version}


def resolve_case(db, user, id_, p):
    c = db.scalar(select(ReconciliationCase).where(ReconciliationCase.id == id_, ReconciliationCase.org_id == user.org_id).with_for_update())
    if c is None:
        raise AppError(404, "not_found", "Case not found.")
    if c.status != "open":
        raise AppError(409, "already_resolved", "This case is already resolved.")
    if p.version != c.version:
        raise AppError(409, "version_conflict", "This case was changed by someone else. Reload and try again.")
    c.status, c.resolution_reason, c.resolved_by, c.resolved_at = "resolved", p.reason, user.id, utcnow()  # expected/actual/variance untouched
    audit(db, user, "reconciliation_case", c.id, "resolve", {"status": "open"}, {"status": "resolved"}, p.reason)
    db.flush()
    return case_out(c)


def paginate(db, q, page, size, mapper):
    total = db.scalar(select(func.count()).select_from(q.order_by(None).subquery()))
    rows = db.execute(q.limit(size).offset((page - 1) * size)).all()
    return {"items": [mapper(*r) if len(r) > 1 else mapper(r[0]) for r in rows], "total": total, "page": page, "page_size": size}
