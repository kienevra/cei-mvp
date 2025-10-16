# Alembic Migrations

## Running Alembic inside the backend container

1. **Run migrations:**
   ```bash
   docker-compose exec backend alembic upgrade head
   ```

2. **Create a new migration:**
   ```bash
   docker-compose exec backend alembic revision --autogenerate -m "your message"
   ```

- Ensure your `.env` file contains a valid `DATABASE_URL`.
- Alembic will read `DATABASE_URL` from the environment inside the container.
