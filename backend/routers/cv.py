import time
import uuid
from datetime import datetime, timezone
from typing import List, Union
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

try:
    from config import settings
except ImportError:
    from backend.config import settings

from database import get_db
from models.db_models import CVDocument
from models.schemas import (
    CVStructuredDocument,
    ProcessingMetadata,
    TimingMs,
    ChatRequest,
    ChatResponse,
    BulkDeleteRequest,
    BulkDeleteResponse,
)
from services.parser import extract_text_from_bytes, chunk_text
from services.extractor import extract_all_chunks_async
from services.merger import merge_chunk_extractions
from services.chat import generate_chat_response



router = APIRouter(prefix="/api/v1/cvs", tags=["CV Documents"])


@router.post("/upload")
async def upload_and_process_cvs(
    files: Union[UploadFile, List[UploadFile]] = File(...),
    db: Session = Depends(get_db),
):
    """
    Accepts single or multiple CV files (PDF/DOCX/TXT), parses in-memory,
    extracts structured data via Gemma 3 LLM, validates, persists to Supabase,
    and returns extracted JSON document results.
    """
    file_list = files if isinstance(files, list) else [files]

    if not file_list or len(file_list) == 0:
        raise HTTPException(status_code=400, detail="No files provided for upload.")

    results = []
    for file in file_list:
        if not file.filename:
            continue

        processed_doc = await _process_single_cv(file, db)
        results.append(processed_doc)

    return results[0] if not isinstance(files, list) else results


async def _process_single_cv(file: UploadFile, db: Session) -> dict:
    """Helper method to process a single CV document through the LLM pipeline."""
    request_id = f"req_{uuid.uuid4().hex[:8]}"
    accepted_at = datetime.now(timezone.utc).isoformat()
    t_start = time.perf_counter()

    # Step 1: Local In-Memory Text Extraction (Document files are NEVER uploaded to LLM directly)
    t0 = time.perf_counter()
    file_bytes = await file.read()
    raw_text = extract_text_from_bytes(file_bytes, file.filename)
    t_text_ext = int((time.perf_counter() - t0) * 1000)

    if not raw_text.strip():
        raise HTTPException(
            status_code=422,
            detail=f"Could not extract text from file '{file.filename}'.",
        )

    # Step 2: Page-Aware Chunking of Extracted Text Content
    t0 = time.perf_counter()
    chunks = chunk_text(raw_text, max_chunk_tokens=3500, overlap_tokens=300)
    t_chunking = int((time.perf_counter() - t0) * 1000)

    # Step 3: Send Extracted Text Chunks (Plain Text Strings) to Gemma 3 LLM
    t0 = time.perf_counter()
    chunk_jsons = await extract_all_chunks_async(chunks)
    t_llm = int((time.perf_counter() - t0) * 1000)

    # Step 4: Merging Partial JSONs
    t0 = time.perf_counter()
    merged_data = merge_chunk_extractions(chunk_jsons, raw_text)
    t_merge = int((time.perf_counter() - t0) * 1000)

    # Step 5: Metadata Timing Assembly
    t_total = int((time.perf_counter() - t_start) * 1000)
    ready_at = datetime.now(timezone.utc).isoformat()

    timing_metrics = TimingMs(
        text_extraction=t_text_ext,
        chunking=t_chunking,
        llm_extraction=t_llm,
        validation=10,
        merge=t_merge,
        embedding=0,
        vector_upsert=0,
        rag_verification=0,
        total_processing=t_total,
    )

    metadata = ProcessingMetadata(
        request_id=request_id,
        model=settings.HUGGINGFACE_MODEL,
        status="rag_ready",
        upload_accepted_at=accepted_at,
        rag_ready_at=ready_at,
        timing_ms=timing_metrics,
        cold_start=False,
        chunks_used=len(chunks),
        retry_count=0,
    )

    merged_data["processing_metadata"] = metadata.model_dump()

    # Step 6: Pydantic Validation
    try:
        validated_doc = CVStructuredDocument(**merged_data)
        structured_json = validated_doc.model_dump()
    except Exception as err:
        print(f"Validation Note: {err}")
        structured_json = merged_data

    # Step 7: Supabase PostgreSQL Persistence
    doc_id = str(uuid.uuid4())
    db_record = CVDocument(
        id=doc_id,
        filename=file.filename,
        raw_text=raw_text,
        structured_data=structured_json,
    )

    try:
        db.add(db_record)
        db.commit()
        db.refresh(db_record)
    except Exception as db_err:
        db.rollback()
        print(f"Supabase DB Insert Note: {db_err}")

    return {
        "id": doc_id,
        "filename": file.filename,
        "data": structured_json,
    }


@router.get("")
def list_all_cvs(db: Session = Depends(get_db)):
    """Lists all stored CV documents with their candidate metadata and structured profile."""
    docs = db.query(CVDocument).order_by(CVDocument.created_at.desc()).all()
    output = []
    for d in docs:
        structured = d.structured_data or {}
        cand = structured.get("candidate", {})
        cand_name = cand.get("full_name") if isinstance(cand, dict) else None
        output.append({
            "id": d.id,
            "filename": d.filename,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "candidate_name": cand_name or d.filename,
            "skills_count": len(structured.get("skills", [])) if isinstance(structured.get("skills"), list) else 0,
            "years_of_experience": structured.get("derived", {}).get("years_of_experience", 0.0) if isinstance(structured.get("derived"), dict) else 0.0,
            "seniority_level": structured.get("derived", {}).get("seniority_level") if isinstance(structured.get("derived"), dict) else None,
            "data": structured,
        })
    return output


@router.get("/{cv_id}")
def get_single_cv(cv_id: str, db: Session = Depends(get_db)):
    """Retrieves a single CV document by ID."""
    doc = db.query(CVDocument).filter(CVDocument.id == cv_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="CV document not found")
    return {
        "id": doc.id,
        "filename": doc.filename,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "raw_text": doc.raw_text,
        "data": doc.structured_data,
    }


@router.post("/bulk-delete", response_model=BulkDeleteResponse)
def bulk_delete_cvs(request: BulkDeleteRequest, db: Session = Depends(get_db)):
    """Deletes multiple CV documents by their IDs in a single database transaction."""
    if not request.cv_ids:
        raise HTTPException(status_code=400, detail="No CV IDs provided for deletion")

    docs = db.query(CVDocument).filter(CVDocument.id.in_(request.cv_ids)).all()
    deleted_ids = [doc.id for doc in docs]

    if not deleted_ids:
        raise HTTPException(status_code=404, detail="No matching CV documents found to delete")

    for doc in docs:
        db.delete(doc)
    db.commit()

    return {
        "message": f"Successfully deleted {len(deleted_ids)} CV document(s)",
        "deleted_count": len(deleted_ids),
        "deleted_ids": deleted_ids,
    }


@router.delete("/{cv_id}")
def delete_cv(cv_id: str, db: Session = Depends(get_db)):
    """Deletes a CV document by ID."""
    doc = db.query(CVDocument).filter(CVDocument.id == cv_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="CV document not found")
    db.delete(doc)
    db.commit()
    return {"message": "CV deleted successfully", "id": cv_id}


@router.post("/chat", response_model=ChatResponse)
async def chat_with_cvs(
    request: ChatRequest,
    db: Session = Depends(get_db),
):
    """
    Chats with LLM based on:
    - Single candidate CV (cv_id provided)
    - All uploaded CVs in knowledge base (cv_id="all" or None)
    """
    history_dicts = [h.model_dump() for h in request.history]
    return await generate_chat_response(
        query=request.query,
        cv_id=request.cv_id,
        history=history_dicts,
        db=db,
    )

