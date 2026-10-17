import datetime as dt
import hashlib
import hmac
import os

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import config as C
from .database import get_db
from .errors import AppError
from .models import User

# Role -> permissions (configurable starting point; "*" = everything)
PERMISSIONS = {
    "admin": {"*"},
    "operations_manager": {"fruit:read", "fruit:approve", "factory:read", "delivery:read", "reconcile:read", "report:read", "import:write", "audit:read"},
    "field_supervisor": {"fruit:read", "fruit:write", "fruit:submit", "delivery:read", "delivery:dispatch", "report:read"},
    "factory_operator": {"factory:read", "factory:write", "delivery:read", "delivery:receive", "report:read"},
    "reconciliation_officer": {"reconcile:read", "reconcile:resolve", "delivery:read", "fruit:read", "factory:read", "report:read"},
    "auditor": {"fruit:read", "factory:read", "delivery:read", "reconcile:read", "report:read", "audit:read"},
}
_bearer = HTTPBearer(auto_error=False)


def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    return f"{salt.hex()}${hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, 200_000).hex()}"


def verify_password(pw: str, stored: str) -> bool:
    salt, h = stored.split("$")
    return hmac.compare_digest(hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000).hex(), h)


DUMMY = hash_password("not-a-real-password")  # equalises timing for unknown emails


def make_token(user: User, kind: str) -> str:
    ttl = dt.timedelta(minutes=C.ACCESS_MINUTES) if kind == "access" else dt.timedelta(days=C.REFRESH_DAYS)
    return jwt.encode({"sub": str(user.id), "typ": kind, "exp": dt.datetime.now(dt.timezone.utc) + ttl}, C.jwt_secret(), "HS256")


def decode(token: str, kind: str) -> int:
    try:
        p = jwt.decode(token, C.jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise AppError(401, "invalid_token", "Session expired or invalid. Sign in again.")
    if p.get("typ") != kind:
        raise AppError(401, "invalid_token", "Wrong token type.")
    return int(p["sub"])


def current_user(cred: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)) -> User:
    if cred is None:
        raise AppError(401, "not_authenticated", "Sign in to continue.")
    user = db.get(User, decode(cred.credentials, "access"))
    if user is None or not user.is_active:
        raise AppError(401, "invalid_token", "Account not found or disabled.")
    return user


def allowed(user: User, perm: str) -> bool:
    p = PERMISSIONS.get(user.role, set())
    return "*" in p or perm in p


def require(perm: str):
    def dep(user: User = Depends(current_user)) -> User:
        if not allowed(user, perm):
            raise AppError(403, "forbidden", f"Your role cannot perform this action ({perm}).")
        return user
    return dep
