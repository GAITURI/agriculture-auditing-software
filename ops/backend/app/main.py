import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from . import config as C
from .database import Base, SessionLocal, engine
from .errors import AppError, install
from .routers import router

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format='{"t":"%(asctime)s","lvl":"%(levelname)s","msg":"%(message)s"}')


@asynccontextmanager
async def lifespan(_):
    C.jwt_secret()  # fail fast when the signing secret is missing
    if os.getenv("AUTO_CREATE") == "1":  # tests/dev only. Production uses `alembic upgrade head`.
        Base.metadata.create_all(engine)
    yield


app = FastAPI(title="SCIPEC Operations API", version="2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=C.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"], expose_headers=["x-request-id"])
install(app)
app.include_router(router)


@app.get("/health/live")
@app.get("/health")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready():
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        raise AppError(503, "not_ready", "Database unavailable.")
    return {"status": "ready"}
