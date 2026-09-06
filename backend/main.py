import sys
from pathlib import Path

# Ensure backend directory is in sys.path for consistent imports
_backend_dir = str(Path(__file__).resolve().parent)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    from config import settings
    from database import engine, Base, check_db_connection
    from llm import check_llm_connection
    from routers import cv
except ImportError:
    from backend.config import settings
    from backend.database import engine, Base, check_db_connection
    from backend.llm import check_llm_connection
    from backend.routers import cv


# Create database tables if they do not exist
try:
    Base.metadata.create_all(bind=engine)
except Exception as e:
    print(f"Database initialization info: {e}")

app = FastAPI(
    title="RAG CV Ingestion API",
    description="FastAPI Backend for CV Parsing, Hugging Face Gemma LLM extraction, and Supabase storage",
    version="1.0.0",
)

# Configure CORS using allowed origins from environment settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Routers
app.include_router(cv.router)


@app.get("/")
def get_root_info():
    """Returns informative API metadata, service status, documentation links, and available endpoints."""
    db_ok = check_db_connection()
    llm_ok = check_llm_connection()

    return {
        "name": "RAG CV Ingestion & Talent Intelligence API",
        "status": "operational",
        "version": "1.0.0",
        "description": "FastAPI backend for multi-page CV parsing, structured entity extraction with Google Gemma 3, and cross-CV interactive AI chat.",
        "documentation": {
            "swagger_ui": "/docs",
            "redoc": "/redoc",
            "openapi_spec": "/openapi.json",
        },
        "services": {
            "database": {
                "provider": "Supabase PostgreSQL",
                "connected": db_ok,
            },
            "llm_inference": {
                "model": settings.HUGGINGFACE_MODEL,
                "status": "connected" if llm_ok else "degraded",
            },
        },
        "endpoints": {
            "system_health": "GET /api/status",
            "upload_and_process_cv": "POST /api/v1/cvs/upload",
            "list_all_candidates": "GET /api/v1/cvs",
            "get_candidate_by_id": "GET /api/v1/cvs/{cv_id}",
            "delete_candidate": "DELETE /api/v1/cvs/{cv_id}",
            "bulk_delete_candidates": "POST /api/v1/cvs/bulk-delete",
            "ai_chat_query": "POST /api/v1/cvs/chat",
        },
        "features": [
            "In-memory multi-page PDF & DOCX text extraction with PyMuPDF and python-docx",
            "Zero-loss multi-page work experience and key projects parsing",
            "High-density structured JSON extraction matching CVStructuredDocument schema",
            "Cross-CV semantic search and single-candidate targeted chat",
            "Full SLA latency tracking (extraction, chunking, LLM inference, merge)",
        ],
    }


@app.get("/api/status")
def get_system_status():
    """Returns real-time health status of FastAPI backend, Supabase DB, and Gemma LLM."""
    return {
        "status": "online",
        "service": "RAG Backend API",
        "database": check_db_connection(),
        "llm": check_llm_connection(),
    }
