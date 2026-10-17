import datetime as dt
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.database import SessionLocal
from app.main import app
from app.models import AuditEvent, FruitCollection
from conftest import IS_PG, PW, auth

F, D, R = "/api/v1/fruit-collection", "/api/v1/deliveries", "/api/v1/reconciliation"
fruit = lambda **k: {"date": "2026-09-01", "block": "Bakilo", "harvested": 10, "collected": 10, "transported": 10, **k}
code = lambda r: r.json()["error"]["code"]


def make_record(client, **k):
    h = auth(client, "field_supervisor")
    r = client.post(F, json=fruit(**k), headers=h)
    assert r.status_code == 201, r.text
    return r.json(), h


# ---------- authentication / authorization ----------
def test_login_refresh_and_errors(client):
    r = client.post("/api/v1/auth/login", json={"email": "admin@scipec.test", "password": PW}).json()
    assert r["user"]["role"] == "admin" and r["access_token"]
    bad = client.post("/api/v1/auth/login", json={"email": "admin@scipec.test", "password": "wrong"})
    assert bad.status_code == 401 and code(bad) == "invalid_credentials"
    assert client.get(F).status_code == 401
    ok = client.post("/api/v1/auth/refresh", json={"refresh_token": r["refresh_token"]})
    assert ok.status_code == 200
    # an access token must not work as a refresh token
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": r["access_token"]}).status_code == 401


def test_permissions_enforced_server_side(client):
    assert client.post(F, json=fruit(), headers=auth(client, "auditor")).status_code == 403
    rec, _ = make_record(client)
    assert client.post(f"{F}/{rec['id']}/approve", headers=auth(client, "field_supervisor")).status_code == 403
    assert client.post(D, json={}, headers=auth(client, "factory_operator")).status_code == 403
    assert client.get(F, headers=auth(client, "auditor")).status_code == 200


def test_tenant_isolation(client):
    rec, _ = make_record(client)
    other = auth(client, "admin", "other")
    assert client.get(f"{F}/{rec['id']}", headers=other).status_code == 404
    assert client.patch(f"{F}/{rec['id']}", json={"version": 1}, headers=other).status_code == 404
    assert client.get(F, headers=other).json()["total"] == 0
    assert client.post(F, json=fruit(), headers=other).status_code == 422  # 'Bakilo' is not their block


# ---------- fruit workflow, validation, optimistic concurrency ----------
def test_validation_and_duplicates(client):
    h = auth(client, "field_supervisor")
    for bad, c in ((fruit(collected=12), "validation_error"), (fruit(transported=11), "validation_error"),
                   (fruit(harvested=-1), "validation_error"), (fruit(date="2026-08-31"), "validation_error"),
                   (fruit(collected=8, transported=8), "validation_error"), (fruit(block="Nope"), "unknown_block")):
        r = client.post(F, json=bad, headers=h)
        assert r.status_code == 422 and code(r) == c, bad
    assert client.post(F, json=fruit(), headers=h).status_code == 201
    dup = client.post(F, json=fruit(), headers=h)
    assert dup.status_code == 409 and code(dup) == "duplicate_record"


def test_patch_version_check_and_audit(client):
    rec, h = make_record(client)
    ok = client.patch(f"{F}/{rec['id']}", json={"version": rec["version"], "remarks": "wet weather", "reason": "supervisor note"}, headers=h)
    assert ok.status_code == 200 and ok.json()["version"] == rec["version"] + 1 and ok.json()["harvested"] == 10
    stale = client.patch(f"{F}/{rec['id']}", json={"version": rec["version"], "remarks": "x"}, headers=h)
    assert stale.status_code == 409 and code(stale) == "version_conflict"
    ev = client.get("/api/v1/audit?entity=fruit_collection", headers=auth(client, "auditor")).json()["items"]
    upd = [e for e in ev if e["action"] == "update"][0]
    assert upd["before"]["remarks"] is None and upd["after"]["remarks"] == "wet weather" and upd["reason"] == "supervisor note"


def test_submit_approve_four_eyes_and_immutability(client):
    rec, h = make_record(client)
    sub = client.post(f"{F}/{rec['id']}/submit", headers=h)
    assert sub.json()["status"] == "submitted"
    assert client.patch(f"{F}/{rec['id']}", json={"version": sub.json()["version"], "remarks": "late"}, headers=h).status_code == 409
    mgr = auth(client, "operations_manager")
    ap = client.post(f"{F}/{rec['id']}/approve", headers=mgr)
    assert ap.json()["status"] == "approved" and ap.json()["approved_by"]
    assert client.post(f"{F}/{rec['id']}/approve", headers=mgr).status_code == 409
    # admin cannot approve a record they created themselves
    adm = auth(client, "admin")
    mine = client.post(F, json=fruit(date="2026-09-02"), headers=adm).json()
    client.post(f"{F}/{mine['id']}/submit", headers=adm)
    r = client.post(f"{F}/{mine['id']}/approve", headers=adm)
    assert r.status_code == 409 and code(r) == "four_eyes"


def test_reports_ignore_drafts_and_pagination(client):
    rec, h = make_record(client)
    q = "?start=2026-09-01&end=2026-09-03"
    assert client.get(f"/api/v1/dashboard/summary{q}", headers=h).json()["transported"] is None
    client.post(f"{F}/{rec['id']}/submit", headers=h)
    s = client.get(f"/api/v1/dashboard/summary{q}", headers=h).json()
    assert s["transported"] == 10 and s["open_cases"] == 0
    assert client.get(f"{F}?page_size=1&sort=-date", headers=h).json()["page_size"] == 1


# ---------- idempotency, atomicity, concurrency ----------
def test_idempotent_create(client):
    h = {**auth(client, "field_supervisor"), "Idempotency-Key": "abc-1"}
    a, b = client.post(F, json=fruit(), headers=h), client.post(F, json=fruit(), headers=h)
    assert a.status_code == b.status_code == 201 and a.json()["id"] == b.json()["id"]
    diff = client.post(F, json=fruit(harvested=11, collected=11, transported=11), headers=h)
    assert diff.status_code == 422 and code(diff) == "idempotency_conflict"
    with SessionLocal() as db:
        assert db.query(FruitCollection).count() == 1


def test_failed_audit_rolls_back_business_write(client, monkeypatch):
    h = auth(client, "field_supervisor")
    monkeypatch.setattr("app.services.audit", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("secret sql detail")))
    r = TestClient(app, raise_server_exceptions=False).post(F, json=fruit(), headers=h)
    assert r.status_code == 500 and code(r) == "internal_error" and "secret" not in r.text
    with SessionLocal() as db:
        assert db.query(FruitCollection).count() == 0  # all or nothing


def test_audit_events_are_immutable(client):
    make_record(client)
    with SessionLocal() as db:
        ev = db.query(AuditEvent).first()
        ev.reason = "tamper"
        with pytest.raises(RuntimeError):
            db.commit()


@pytest.mark.skipif(not IS_PG, reason="needs PostgreSQL")
def test_concurrent_patches_exactly_one_wins(client):
    rec, h = make_record(client)

    def go(i):
        return TestClient(app).patch(f"{F}/{rec['id']}", json={"version": rec["version"], "remarks": f"w{i}"}, headers=h).status_code
    with ThreadPoolExecutor(8) as ex:
        codes = list(ex.map(go, range(8)))
    assert codes.count(200) == 1 and codes.count(409) == 7, codes


@pytest.mark.skipif(not IS_PG, reason="needs PostgreSQL")
def test_concurrent_duplicate_submissions_create_one_record(client):
    h = {**auth(client, "field_supervisor"), "Idempotency-Key": "race-1"}

    def go(_):
        r = TestClient(app).post(F, json=fruit(), headers=h)
        return r.status_code, r.json().get("id")
    with ThreadPoolExecutor(8) as ex:
        out = list(ex.map(go, range(8)))
    assert {c for c, _ in out} == {201} and len({i for _, i in out}) == 1, out
    with SessionLocal() as db:
        assert db.query(FruitCollection).count() == 1


@pytest.mark.skipif(not IS_PG, reason="needs PostgreSQL")
def test_concurrent_receipts_only_one_succeeds(client):
    d = client.post(D, json=dispatch(), headers=auth(client, "field_supervisor")).json()
    h = auth(client, "factory_operator")

    def go(_):
        return TestClient(app).post(f"{D}/{d['id']}/receipt", json=receipt(), headers=h).status_code
    with ThreadPoolExecutor(6) as ex:
        codes = list(ex.map(go, range(6)))
    assert codes.count(200) == 1 and codes.count(409) == 5, codes


# ---------- delivery-level reconciliation ----------
dispatch = lambda **k: {"reference": "WB-1001", "block": "Bakilo", "vehicle": "KDA 123X", "dispatched_at": "2026-09-01T23:00:00+00:00", "dispatched_qty": 20, **k}
receipt = lambda **k: {"received_at": "2026-09-02T02:00:00+00:00", "received_qty": 20, "weighbridge_ref": "GATE-77", **k}


def test_delivery_crossing_midnight_has_no_false_variance(client):
    d = client.post(D, json=dispatch(), headers=auth(client, "field_supervisor"))
    assert d.status_code == 201
    r = client.post(f"{D}/{d.json()['id']}/receipt", json=receipt(), headers=auth(client, "factory_operator")).json()
    assert r["variance"] == 0 and r["case_id"] is None and r["status"] == "received"


def test_delivery_rules(client):
    sup, fac = auth(client, "field_supervisor"), auth(client, "factory_operator")
    assert client.post(D, json=dispatch(dispatched_at="2026-09-01T23:00:00"), headers=sup).status_code == 422  # naive timestamp
    d = client.post(D, json=dispatch(), headers=sup).json()
    assert code(client.post(D, json=dispatch(), headers=sup)) == "duplicate_reference"
    early = client.post(f"{D}/{d['id']}/receipt", json=receipt(received_at="2026-09-01T10:00:00+00:00"), headers=fac)
    assert early.status_code == 422 and code(early) == "receipt_before_dispatch"


def test_discrepancy_case_and_resolution_preserves_original(client):
    sup, fac, off = auth(client, "field_supervisor"), auth(client, "factory_operator"), auth(client, "reconciliation_officer")
    d = client.post(D, json=dispatch(), headers=sup).json()
    r = client.post(f"{D}/{d['id']}/receipt", json=receipt(received_qty=18.7), headers=fac).json()
    assert round(r["variance"], 3) == -1.3 and r["case_id"]
    case = client.get(f"{R}/{r['case_id']}", headers=off).json()
    assert case["status"] == "open" and case["expected"] == 20 and case["actual"] == 18.7
    assert client.post(f"{R}/{case['id']}/resolve", json={"reason": "Spillage on haul road", "version": case["version"]}, headers=fac).status_code == 403
    res = client.post(f"{R}/{case['id']}/resolve", json={"reason": "x", "version": case["version"]}, headers=off)
    assert res.status_code == 422  # explanation required
    res = client.post(f"{R}/{case['id']}/resolve", json={"reason": "Spillage on haul road", "version": case["version"]}, headers=off).json()
    assert res["status"] == "resolved" and res["expected"] == 20 and res["actual"] == 18.7 and res["variance"] == -1.3
    assert client.post(f"{R}/{case['id']}/resolve", json={"reason": "again again", "version": 2}, headers=off).status_code == 409
    hist = client.get(f"{R}/{case['id']}", headers=off).json()["history"]
    assert [h["action"] for h in hist] == ["open", "resolve"] and hist[1]["reason"] == "Spillage on haul road"
    assert client.get("/api/v1/reports/operational-variance", headers=off).json()[0]["cases"] == 1


# ---------- workbook import ----------
def workbook(rows_fc, rows_fp=()):
    wb = Workbook(); a = wb.active; a.title = "Fruit Collection"
    a.append(["T"]); a.append([]); a.append([])
    a.append(["Date", "Block", "H", "C", "T", "Hv", "Co", "L", "Reason", "Rem"])
    [a.append(r) for r in rows_fc]
    b = wb.create_sheet("Factory Production")
    b.append(["T"]); b.append([]); b.append([])
    b.append(["Date", "B1", "B2", "B3", "Tot", "P", "O", "Y", "Dt", "Rem"])
    [b.append(r) for r in rows_fp]
    buf = BytesIO(); wb.save(buf); return buf.getvalue()


def up(client, data, h, **params):
    return client.post("/api/v1/import", params=params, files={"file": ("w.xlsx", data)}, headers=h)


def test_import_preview_commit_blank_cells_and_audit(client):
    rec, sup = make_record(client, harvesters=5)
    mgr, d = auth(client, "operations_manager"), dt.datetime(2026, 9, 1)
    wb = workbook([[d, "Bakilo", 12, 12, 12, None, None, None, None, None]])
    prev = up(client, wb, mgr).json()
    assert prev["updates"] == 1 and not prev["committed"]
    assert client.get(f"{F}/{rec['id']}", headers=sup).json()["harvested"] == 10
    done = up(client, wb, mgr, commit="true").json()
    assert done["committed"]
    row = client.get(f"{F}/{rec['id']}", headers=sup).json()
    assert row["harvested"] == 12 and row["harvesters"] == 5 and row["status"] == "draft"  # blank cell kept 5
    ev = client.get("/api/v1/audit?entity=import", headers=auth(client, "auditor")).json()["items"]
    assert ev[0]["after"]["sha256"] == done["sha256"]
    cleared = up(client, wb, mgr, commit="true", mode="replace").json()
    assert cleared["cleared_cells"][0]["fields"] == ["harvesters"]


def test_import_rejects_bad_rows_and_approved_conflicts_atomically(client):
    rec, sup = make_record(client)
    client.post(f"{F}/{rec['id']}/submit", headers=sup)
    mgr = auth(client, "operations_manager")
    client.post(f"{F}/{rec['id']}/approve", headers=mgr)
    d = dt.datetime(2026, 9, 1)
    wb = workbook([[d, "Bakilo", 99, 99, 99, None, None, None, None, None],            # approved: protected
                   [dt.datetime(2026, 9, 2), "Batchepo", 5, 9, 5, None, None, None, None, None],  # collected > harvested
                   [dt.datetime(2026, 9, 3), "Ghost", 5, 5, 5, None, None, None, None, None]])    # unknown block
    r = up(client, wb, mgr, commit="true")
    assert r.status_code == 422 and code(r) == "import_rejected" and len(r.json()["error"]["details"]["errors"]) == 3
    assert client.get(F, headers=mgr).json()["total"] == 1 and client.get(f"{F}/{rec['id']}", headers=mgr).json()["harvested"] == 10
    assert up(client, b"not a zip", mgr).status_code == 415
    assert up(client, wb, auth(client, "field_supervisor")).status_code == 403
