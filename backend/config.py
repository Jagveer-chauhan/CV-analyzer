from pathlib import Path
import os
from dotenv import load_dotenv

# Load environment variables from backend/.env or root .env
_env_path = Path(__file__).resolve().parent / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path)
else:
    load_dotenv()



class Settings:
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    HUGGINGFACE_API_BASE_URL: str = os.getenv(
        "HUGGINGFACE_API_BASE_URL", "https://api-inference.huggingface.co/models"
    )
    HUGGINGFACE_TOKEN: str = os.getenv("HUGGINGFACE_TOKEN", "")
    HUGGINGFACE_MODEL: str = os.getenv("HUGGINGFACE_MODEL", "google/gemma-3-4b-it")
    ALLOWED_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv(
            "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if origin.strip()
    ]


settings = Settings()
