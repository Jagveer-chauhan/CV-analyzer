from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
try:
    from config import settings
except ImportError:
    from backend.config import settings


# Initialize SQLAlchemy engine using DATABASE_URL from settings
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def check_db_connection() -> dict:
    """Check connectivity to Supabase PostgreSQL database."""
    if not settings.DATABASE_URL:
        return {
            "status": "error",
            "message": "DATABASE_URL environment variable is not set",
        }

    try:
        with engine.connect() as connection:
            result = connection.execute(text("SELECT 1"))
            result.scalar()
        return {
            "status": "connected",
            "provider": "Supabase PostgreSQL",
            "details": "Database connection verified",
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Database connection failed: {str(e)}",
        }


def get_db():
    """Dependency for providing a database session in FastAPI routes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
