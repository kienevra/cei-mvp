from sqlalchemy import create_engine, text

engine = create_engine(
    "postgresql+psycopg2://neondb_owner:npg_RnHcZO70oTyw@ep-damp-shadow-alwbchv5.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require"
)

with engine.connect() as conn:
    result = conn.execute(
        text("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
    )
    print(result.fetchall())