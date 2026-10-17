import datetime as dt
import os

CYCLE_START = dt.date.fromisoformat(os.getenv("CYCLE_START", "2026-09-01"))
CYCLE_END = dt.date.fromisoformat(os.getenv("CYCLE_END", "2026-09-30"))
INITIAL_BLOCKS = ["Banakanuke", "Batchepo", "Bakilo"]  # seed data only; blocks live in the database
ORG_NAME, ORG_WEBSITE = "SCIPEC", "https://scipec.vercel.app"
VARIANCE_T = os.getenv("VARIANCE_TONNES", "0.5")  # kept as str -> Decimal, never float
OER_MIN, OER_MAX = 15.0, 26.0
MAX_DOWNTIME = 24
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
ACCESS_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "15"))
REFRESH_DAYS = int(os.getenv("REFRESH_TOKEN_DAYS", "7"))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(5 * 1024 * 1024)))


def jwt_secret():
    s = os.getenv("JWT_SECRET")
    if not s or len(s) < 32:
        raise RuntimeError("JWT_SECRET must be set (32+ characters)")
    return s
