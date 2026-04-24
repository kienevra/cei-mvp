from sqlalchemy import create_engine, text

engine = create_engine("postgresql+psycopg2://neondb_owner:npg_RnHcZO70oTyw@ep-damp-shadow-alwbchv5.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require")

with engine.connect() as conn:
    conn.execute(text("DROP SCHEMA public CASCADE"))
    conn.execute(text("CREATE SCHEMA public"))
    conn.commit()

print("DB FULLY RESET")