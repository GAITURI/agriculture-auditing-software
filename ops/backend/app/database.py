import os
from sqlalchemy import MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/ops")
_sqlite = DATABASE_URL.startswith("sqlite")
_kw = {"connect_args": {"check_same_thread": False}} if _sqlite else {
    "pool_size": int(os.getenv("DB_POOL_SIZE", "10")), "max_overflow": 10,
    "connect_args": {"options": f"-c statement_timeout={os.getenv('DB_STATEMENT_TIMEOUT_MS', '15000')}"}}
engine = create_engine(DATABASE_URL, pool_pre_ping=True, **_kw)
SessionLocal = sessionmaker(bind=engine, autoflush=False)

NAMING = {"ix": "ix_%(column_0_label)s", "uq": "uq_%(table_name)s_%(column_0_name)s",
          "ck": "ck_%(table_name)s_%(constraint_name)s", "pk": "pk_%(table_name)s",
          "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
