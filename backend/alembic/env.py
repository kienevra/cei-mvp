import os
from logging.config import fileConfig
from alembic import context
from sqlalchemy import engine_from_config, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# override sqlalchemy.url with the env var when present
database_url = os.environ.get('DATABASE_URL')
if database_url:
    config.set_main_option('sqlalchemy.url', database_url)

# HINT: Alembic will use settings.DATABASE_URL if present in the environment.
# See: os.environ.get('DATABASE_URL') in env.py
# Ensure your .env is loaded or DATABASE_URL is set before running migrations.

# import your app's metadata object for 'autogenerate'
# ensure backend is on sys.path when running alembic from project root
import sys
from pathlib import Path
proj_root = Path(__file__).resolve().parents[2]  # project_root/backend/alembic -> project_root
sys.path.insert(0, str(proj_root / 'backend'))

try:
    from app.db.base import Base
    target_metadata = Base.metadata
except Exception:
    # Fallback: try importing models directly (ensures models register with Base)
    try:
        import app.models  # noqa: F401
        from app.db.base import Base
        target_metadata = Base.metadata
    except Exception:
        target_metadata = None

def run_migrations_offline():
    url = config.get_main_option('sqlalchemy.url')
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix='sqlalchemy.',
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
