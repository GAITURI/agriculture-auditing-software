"""Single source of truth for business rules: used by manual entry AND Excel import."""
import datetime as dt
from decimal import Decimal
from pydantic import BaseModel, Field, field_validator, model_validator
from . import config as C

D = Decimal


def _check_period(v):
    if not C.CYCLE_START <= v <= C.CYCLE_END:
        raise ValueError(f"date must be within {C.CYCLE_START}..{C.CYCLE_END}")
    if v > dt.date.today():
        raise ValueError("future-dated records are not allowed")
    return v


class FruitIn(BaseModel):
    date: dt.date
    block: str
    harvested: D | None = Field(None, ge=0)
    collected: D | None = Field(None, ge=0)
    transported: D | None = Field(None, ge=0)
    harvesters: int | None = Field(None, ge=0)
    collectors: int | None = Field(None, ge=0)
    reason: str | None = None
    remarks: str | None = None

    _period = field_validator("date")(_check_period)

    @field_validator("block")
    @classmethod
    def _block(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("block is required")
        return v

    @model_validator(mode="after")
    def _rules(self):
        h, c, t = self.harvested, self.collected, self.transported
        if h is not None and c is not None and c > h:
            raise ValueError("collected cannot exceed harvested")
        if c is not None and t is not None and t > c:
            raise ValueError("transported cannot exceed collected")
        if self.left and self.left > 0 and not (self.reason or "").strip():
            raise ValueError("a reason is required when fruit is left in the field")
        return self

    @property
    def left(self):
        if self.harvested is None or self.collected is None:
            return None
        return self.harvested - self.collected


class FactoryIn(BaseModel):
    date: dt.date
    ffb_banakanuke: D | None = Field(None, ge=0)
    ffb_batchepo: D | None = Field(None, ge=0)
    ffb_bakilo: D | None = Field(None, ge=0)
    total_received: D | None = Field(None, ge=0)
    processed: D | None = Field(None, ge=0)
    oil: D | None = Field(None, ge=0)
    downtime: D | None = Field(None, ge=0, le=C.MAX_DOWNTIME)
    remarks: str | None = None

    _period = field_validator("date")(_check_period)

    @model_validator(mode="after")
    def _rules(self):
        if self.oil is not None and self.processed is not None:
            if self.oil > self.processed:
                raise ValueError("palm oil produced cannot exceed FFB processed")
            if self.processed == 0 and self.oil > 0:
                raise ValueError("oil cannot be produced when processed FFB is zero")
        return self

    @property
    def source_sum(self):
        parts = [self.ffb_banakanuke, self.ffb_batchepo, self.ffb_bakilo]
        return None if all(p is None for p in parts) else sum((p or D(0)) for p in parts)

    @property
    def received(self):
        return self.total_received if self.total_received is not None else self.source_sum

    def warnings(self):
        w = []
        if self.total_received is not None and self.source_sum is not None \
                and abs(self.total_received - self.source_sum) > D("0.001"):
            w.append(f"Total received {self.total_received} differs from block sum {self.source_sum}")
        if self.processed and self.oil is not None:
            oer = float(self.oil / self.processed * 100)
            if not C.OER_MIN <= oer <= C.OER_MAX:
                w.append(f"Oil extraction rate {oer:.1f}% is outside {C.OER_MIN}-{C.OER_MAX}%: supervisor review")
        return w


class FruitPatch(BaseModel):
    """Partial update. Only fields present in the request change; explicit null clears a value."""
    version: int
    reason: str | None = None  # why the change was made (audited)
    harvested: D | None = None
    collected: D | None = None
    transported: D | None = None
    harvesters: int | None = None
    collectors: int | None = None
    remarks: str | None = None
    shortfall_reason: str | None = None


class LoginIn(BaseModel):
    email: str
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


def _aware(v):
    if v.tzinfo is None:
        raise ValueError("timestamp must include a timezone offset, e.g. 2026-09-01T23:00:00+02:00")
    return v


class DeliveryIn(BaseModel):
    reference: str = Field(min_length=3, max_length=40)
    block: str
    vehicle: str | None = Field(None, max_length=40)
    dispatched_at: dt.datetime
    dispatched_qty: D = Field(ge=0)
    _tz = field_validator("dispatched_at")(_aware)


class ReceiptIn(BaseModel):
    received_at: dt.datetime
    received_qty: D = Field(ge=0)
    weighbridge_ref: str | None = Field(None, max_length=40)
    _tz = field_validator("received_at")(_aware)


class ResolveIn(BaseModel):
    reason: str = Field(min_length=5, max_length=2000)
    version: int
