from alembic import context
from app import models  # noqa: F401  (registers tables)
from app.database import Base, engine

target = Base.metadata


def run():
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=target, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


run()
