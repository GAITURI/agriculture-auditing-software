"""Controlled, repeatable seed:  ADMIN_EMAIL=... ADMIN_PASSWORD=... python -m app.seed"""
import os
import sys

from sqlalchemy import select

from . import config as C
from .database import SessionLocal
from .models import Block, Organization, Site, User
from .security import hash_password


def seed(admin_email=None, admin_password=None):
    with SessionLocal() as db:
        org = db.scalar(select(Organization).where(Organization.name == C.ORG_NAME)) or Organization(name=C.ORG_NAME, website=C.ORG_WEBSITE)
        db.add(org); db.flush()
        site = db.scalar(select(Site).where(Site.org_id == org.id)) or Site(org_id=org.id, name="Main estate")
        db.add(site); db.flush()
        have = set(db.scalars(select(Block.name).where(Block.site_id == site.id)))
        db.add_all(Block(site_id=site.id, name=n) for n in C.INITIAL_BLOCKS if n not in have)
        if admin_email and not db.scalar(select(User.id).where(User.email == admin_email.lower())):
            db.add(User(org_id=org.id, email=admin_email.lower(), full_name="Administrator", role="admin", password_hash=hash_password(admin_password)))
        db.commit()


if __name__ == "__main__":
    e, p = os.getenv("ADMIN_EMAIL"), os.getenv("ADMIN_PASSWORD")
    if bool(e) != bool(p) or (p and len(p) < 12):
        sys.exit("Set both ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters), or neither.")
    seed(e, p)
    print("seed complete")
