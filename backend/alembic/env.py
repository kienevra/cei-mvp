import os
import sys
from pathlib import Path
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Alembic Config object (from alembic.ini)
config = context.config

# Configure Python logging (alembic.ini)
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Force sqlalchemy.url to come from DATABASE_URL, with a safe local default.
db_url = os.environ.get("DATABASE_URL", "sqlite:///../dev.db")
config.set_main_option("sqlalchemy.url", db_url)

# Ensure backend/ is on sys.path when running alembic from backend/
proj_root = Path(__file__).resolve().parents[2]  # project_root/backend/alembic -> project_root
sys.path.insert(0, str(proj_root / "backend"))

# IMPORTANT:
# Import Base, then import app.models to register ALL models with Base.metadata
from app.db.base import Base  # noqa: E402
import app.models  # noqa: F401, E402  (registers models)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
