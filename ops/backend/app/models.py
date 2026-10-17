import datetime as dt
from decimal import Decimal
from sqlalchemy import (JSON, Boolean, CheckConstraint as CK, Date, DateTime, ForeignKey, Index, Integer,
                        Numeric, String, Text, UniqueConstraint as UQ, event)
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base

Qty = Numeric(14, 3)  # NULL = not measured, never silently 0
TS = DateTime(timezone=True)  # stored UTC


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    website: Mapped[str | None] = mapped_column(String(200))


class Site(Base):
    __tablename__ = "sites"
    __table_args__ = (UQ("org_id", "name"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(String(120))


class Block(Base):
    __tablename__ = "blocks"
    __table_args__ = (UQ("site_id", "name"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"))
    name: Mapped[str] = mapped_column(String(60))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"))
    email: Mapped[str] = mapped_column(String(200), unique=True)
    full_name: Mapped[str | None] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(30))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class FruitCollection(Base):
    __tablename__ = "fruit_collection"
    __table_args__ = (
        UQ("date", "block_id"),
        CK("status IN ('draft','submitted','approved')", name="status_valid"),
        CK("harvested >= 0 AND collected >= 0 AND transported >= 0 AND left_in_field >= 0", name="qty_nonneg"),
        CK("harvesters >= 0 AND collectors >= 0", name="workers_nonneg"),
        CK("collected <= harvested", name="collected_le_harvested"),
        CK("transported <= collected", name="transported_le_collected"),
        Index("ix_fruit_block_date", "block_id", "date"), Index("ix_fruit_status", "status"))
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date)
    block_id: Mapped[int] = mapped_column(ForeignKey("blocks.id"))
    harvested: Mapped[Decimal | None] = mapped_column(Qty)
    collected: Mapped[Decimal | None] = mapped_column(Qty)
    transported: Mapped[Decimal | None] = mapped_column(Qty)
    harvesters: Mapped[int | None] = mapped_column(Integer)
    collectors: Mapped[int | None] = mapped_column(Integer)
    left_in_field: Mapped[Decimal | None] = mapped_column(Qty)  # derived: harvested - collected
    reason: Mapped[str | None] = mapped_column(Text)
    remarks: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(12), default="draft")
    version: Mapped[int] = mapped_column(Integer)  # optimistic concurrency (SQLAlchemy version_id_col)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(TS, default=utcnow)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[dt.datetime | None] = mapped_column(TS)
    __mapper_args__ = {"version_id_col": version}


class FactoryProduction(Base):
    __tablename__ = "factory_production"
    __table_args__ = (UQ("org_id", "date"),
                      CK("downtime >= 0 AND downtime <= 24", name="downtime_range"),
                      CK("ffb_banakanuke >= 0 AND ffb_batchepo >= 0 AND ffb_bakilo >= 0 AND processed >= 0 AND oil >= 0", name="qty_nonneg"),
                      CK("oil <= processed", name="oil_le_processed"))
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"))
    date: Mapped[dt.date] = mapped_column(Date)
    ffb_banakanuke: Mapped[Decimal | None] = mapped_column(Qty)
    ffb_batchepo: Mapped[Decimal | None] = mapped_column(Qty)
    ffb_bakilo: Mapped[Decimal | None] = mapped_column(Qty)
    total_received: Mapped[Decimal | None] = mapped_column(Qty)
    processed: Mapped[Decimal | None] = mapped_column(Qty)
    oil: Mapped[Decimal | None] = mapped_column(Qty)
    downtime: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    remarks: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[dt.datetime] = mapped_column(TS, default=utcnow)
    __mapper_args__ = {"version_id_col": version}


class Delivery(Base):
    """One truck/load. Dispatch and receipt may fall on different dates; reconciled by this row."""
    __tablename__ = "deliveries"
    __table_args__ = (UQ("org_id", "reference"),
                      CK("status IN ('in_transit','received')", name="status_valid"),
                      CK("dispatched_qty >= 0 AND received_qty >= 0", name="qty_nonneg"),
                      CK("received_at >= dispatched_at", name="receipt_after_dispatch"),
                      CK("(received_qty IS NULL) = (received_at IS NULL)", name="receipt_complete"),
                      Index("ix_deliveries_org_dispatched", "org_id", "dispatched_at"), Index("ix_deliveries_status", "status"))
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"))
    reference: Mapped[str] = mapped_column(String(40))
    block_id: Mapped[int] = mapped_column(ForeignKey("blocks.id"))
    vehicle: Mapped[str | None] = mapped_column(String(40))
    dispatched_at: Mapped[dt.datetime] = mapped_column(TS)
    dispatched_qty: Mapped[Decimal] = mapped_column(Qty)
    received_at: Mapped[dt.datetime | None] = mapped_column(TS)
    received_qty: Mapped[Decimal | None] = mapped_column(Qty)
    weighbridge_ref: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(12), default="in_transit")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=utcnow)
    version: Mapped[int] = mapped_column(Integer)
    __mapper_args__ = {"version_id_col": version}


class ReconciliationCase(Base):
    """variance = actual(received) - expected(dispatched); negative = shrinkage. Original values never edited."""
    __tablename__ = "reconciliation_cases"
    __table_args__ = (CK("status IN ('open','resolved')", name="status_valid"), Index("ix_cases_org_status", "org_id", "status"))
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"))
    delivery_id: Mapped[int] = mapped_column(ForeignKey("deliveries.id"), unique=True)
    expected: Mapped[Decimal] = mapped_column(Qty)
    actual: Mapped[Decimal] = mapped_column(Qty)
    variance: Mapped[Decimal] = mapped_column(Qty)
    status: Mapped[str] = mapped_column(String(10), default="open")
    resolution_reason: Mapped[str | None] = mapped_column(Text)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    resolved_at: Mapped[dt.datetime | None] = mapped_column(TS)
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=utcnow)
    version: Mapped[int] = mapped_column(Integer)
    __mapper_args__ = {"version_id_col": version}


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_entity", "entity", "entity_id"), Index("ix_audit_org_at", "org_id", "at"))
    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[dt.datetime] = mapped_column(TS, default=utcnow)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(40))
    reason: Mapped[str | None] = mapped_column(Text)
    correlation_id: Mapped[str | None] = mapped_column(String(64))
    before: Mapped[dict | None] = mapped_column(JSON)
    after: Mapped[dict | None] = mapped_column(JSON)


@event.listens_for(AuditEvent, "before_update")
@event.listens_for(AuditEvent, "before_delete")
def _immutable(*_):  # app-level guard; the migration also adds a PostgreSQL trigger
    raise RuntimeError("audit events are immutable")


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"
    __table_args__ = (UQ("user_id", "key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    key: Mapped[str] = mapped_column(String(80))
    request_hash: Mapped[str] = mapped_column(String(64))
    status_code: Mapped[int] = mapped_column(Integer)
    response: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[dt.datetime] = mapped_column(TS, default=utcnow)
