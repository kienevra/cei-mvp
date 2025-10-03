import os, traceback
from sqlalchemy import create_engine, text

try:
    url = os.environ.get('DATABASE_URL')
    print('DB URL present:', bool(url))
    # decide ssl
    connect_args = {'sslmode':'require'} if (url and 'sslmode=require' in url) else {}
    engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True)
    with engine.connect() as conn:
        ver = conn.execute(text('select version()')).scalar()
        one = conn.execute(text('select 1')).scalar()
        print('Postgres version (masked):', ver.split(',')[0] if ver else 'unknown')
        print('select 1 ->', one)
except Exception:
    traceback.print_exc()
    raise
