from sqlalchemy import create_engine, text

DATABASE_URL = "postgresql://neondb_owner:npg_RnHcZO70oTyw@ep-damp-shadow-alwbchv5.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require"

engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    print(conn.execute(text("SELECT 1")).fetchall())