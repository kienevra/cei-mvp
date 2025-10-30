"""Safe Alembic migration runner.

Usage:
    python backend/scripts/safe_migrate.py -c backend/alembic.ini
Reads the alembic config, compares DB current revision vs local head(s),
and only executes upgrade if DB is behind.
"""
import sys
import argparse
import os
from alembic.config import Config
from alembic import command
from alembic.script import ScriptDirectory
from alembic.runtime.environment import EnvironmentContext

def get_db_revision(alembic_cfg):
    """Return current DB revision or None"""
    # use EnvironmentContext.run_migrations with a callback that captures current head
    script = ScriptDirectory.from_config(alembic_cfg)
    rev = None
    def _get_rev(rev_, context):
        nonlocal rev
        rev = context.get_current_heads()
    with EnvironmentContext(alembic_cfg, script) as env:
        env.run_migrations(_get_rev)
    return rev

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("-c", "--config", default="backend/alembic.ini", help="alembic ini path")
    parser.add_argument("--stamp-if-empty", action="store_true", help="stamp head if no alembic_version table")
    args = parser.parse_args()

    cfg = Config(args.config)
    # if DATABASE_URL set in env, env.py will set it in config; otherwise alembic.ini must have sqlalchemy.url
    # resolve script directory
    script = ScriptDirectory.from_config(cfg)

    # local heads (could be multiple if branches)
    local_heads = script.get_heads()
    print("Local heads:", local_heads)

    try:
        db_heads = get_db_revision(cfg)
    except Exception as e:
        print("Error getting DB revision:", e)
        db_heads = None

    print("DB heads:", db_heads)

    if not db_heads or db_heads == []:
        print("No alembic_version found in DB (fresh DB or not stamped).")
        if args.stamp_if_empty:
            print("Stamping database to local head(s):", local_heads)
            command.stamp(cfg, "head")
            print("Stamped.")
            return  # done
        else:
            print("Will run upgrade to head to create/align DB.")
            do_upgrade = True
    else:
        # if db_heads differ from local heads, migrations pending
        if set(db_heads) == set(local_heads):
            print("Database is up-to-date (no pending migrations).")
            do_upgrade = False
        else:
            print("Pending migrations detected.")
            do_upgrade = True

    if do_upgrade:
        print("Running alembic upgrade head...")
        command.upgrade(cfg, "head")
        print("Upgrade complete.")
    else:
        print("No action taken.")

if __name__ == "__main__":
    main()
