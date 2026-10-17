import os
os.environ.setdefault("JWT_SECRET", "t" * 40)
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL", "sqlite:///./test.db")
import pytest
from fastapi.testclient import TestClient
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import Block, Organization, Site, User
from app.security import PERMISSIONS, hash_password

IS_PG = engine.dialect.name == "postgresql"
PW = "Test-pass-123"
ROLES = list(PERMISSIONS)


@pytest.fixture()
def world():
    Base.metadata.drop_all(engine); Base.metadata.create_all(engine)
    with SessionLocal() as db:
        ph = hash_password(PW)
        for name, blocks in (("SCIPEC", ["Banakanuke", "Batchepo", "Bakilo"]), ("Other Co", ["Kivu"])):
            org = Organization(name=name); db.add(org); db.flush()
            site = Site(org_id=org.id, name="Main"); db.add(site); db.flush()
            db.add_all(Block(site_id=site.id, name=b) for b in blocks)
            for role in (ROLES if name == "SCIPEC" else ["admin"]):
                db.add(User(org_id=org.id, email=f"{role}@{'scipec' if name == 'SCIPEC' else 'other'}.test", role=role, password_hash=ph))
        db.commit()


@pytest.fixture()
def client(world):
    return TestClient(app)


def auth(client, role, org="scipec"):
    r = client.post("/api/v1/auth/login", json={"email": f"{role}@{org}.test", "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
