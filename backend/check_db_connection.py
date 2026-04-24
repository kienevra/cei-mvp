from sqlalchemy import create_engine, text

engine = create_engine("postgresql://neondb_owner:npg_RnHcZO70oTyw@ep-damp-shadow-alwbchv5-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require")

with engine.connect() as conn:
    print(conn.execute(text("SELECT current_database(), current_schema()")).fetchall())