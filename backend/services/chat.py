"""
Chat Service for CV Grounded RAG Assistant.

Handles conversational interactions with Gemma 3 LLM:
- Single-CV Mode: Answers specific questions grounded in one candidate's CV.
- All-CVs Mode: Answers cross-candidate queries, comparisons, and talent searches.
"""

import time
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from models.db_models import CVDocument
from services.extractor import get_async_client


async def generate_chat_response(
    query: str,
    cv_id: Optional[str],
    history: List[Dict[str, str]],
    db: Session,
) -> Dict[str, Any]:
    """
    Main entry point for generating chat responses based on single or all CVs.
    """
    t_start = time.perf_counter()

    # Determine mode: specific CV vs all CVs
    if cv_id and cv_id != "all":
        doc = db.query(CVDocument).filter(CVDocument.id == cv_id).first()
        if not doc:
            return {
                "reply": f"Candidate CV with ID '{cv_id}' was not found in the database.",
                "sources": [],
                "latency_ms": 0,
                "context_mode": "single_cv",
                "candidate_name": None,
            }
        return await _chat_with_single_cv(doc, query, history, t_start)
    else:
        docs = db.query(CVDocument).order_by(CVDocument.created_at.desc()).limit(20).all()
        if not docs:
            return {
                "reply": "No candidate CVs have been uploaded yet. Please upload one or more CVs first to begin chatting.",
                "sources": [],
                "latency_ms": 0,
                "context_mode": "all_cvs",
                "candidate_name": None,
            }
        return await _chat_with_all_cvs(docs, query, history, t_start)


async def _chat_with_single_cv(
    doc: CVDocument,
    query: str,
    history: List[Dict[str, str]],
    t_start: float,
) -> Dict[str, Any]:
    """Generates an answer grounded strictly in a single candidate's CV."""
    structured = doc.structured_data or {}
    candidate_info = structured.get("candidate", {})
    candidate_name = candidate_info.get("full_name") or doc.filename

    # Build concise context block from structured fields and raw text
    context_lines = [
        f"CANDIDATE: {candidate_name}",
        f"FILENAME: {doc.filename}",
        f"EMAIL: {candidate_info.get('email', 'N/A')}",
        f"PHONE: {candidate_info.get('phone', 'N/A')}",
        f"LOCATION: {candidate_info.get('location', 'N/A')}",
        f"SUMMARY: {structured.get('summary', 'N/A')}",
        f"SKILLS: {', '.join(structured.get('skills', []))}",
        f"YEARS OF EXPERIENCE: {structured.get('derived', {}).get('years_of_experience', 'N/A')}",
        f"SENIORITY: {structured.get('derived', {}).get('seniority_level', 'N/A')}",
    ]

    # Add experience snippets
    experiences = structured.get("experience", [])
    if experiences:
        context_lines.append("\nWORK EXPERIENCE:")
        for exp in experiences[:5]:
            role = exp.get("role", "Role")
            company = exp.get("company", "Company")
            dates = f"{exp.get('start_date', '')} - {exp.get('end_date', '')}"
            responsibilities = "; ".join(exp.get("responsibilities", [])[:3])
            context_lines.append(f"- {role} at {company} ({dates}): {responsibilities}")

    # Add education snippets
    education = structured.get("education", [])
    if education:
        context_lines.append("\nEDUCATION:")
        for edu in education[:3]:
            deg = edu.get("degree", "Degree")
            inst = edu.get("institution", "Institution")
            dates = f"{edu.get('start_date', '')} - {edu.get('end_date', '')}"
            context_lines.append(f"- {deg} from {inst} ({dates})")

    context_str = "\n".join(context_lines)

    system_prompt = (
        "You are an expert HR and Talent Acquisition Assistant. "
        "Your task is to answer questions about the specific candidate CV provided in the context below. "
        "Guidelines:\n"
        "1. Ground your answers strictly on the candidate's CV details.\n"
        "2. Be concise, professional, and clear.\n"
        "3. Use bullet points or short paragraphs for readability.\n"
        "4. If something is not in the CV, state clearly that it is not mentioned.\n\n"
        f"--- CANDIDATE CONTEXT ---\n{context_str}\n-------------------------"
    )

    messages = [{"role": "system", "content": system_prompt}]

    # Include recent conversation turns (up to last 4)
    for msg in (history or [])[-4:]:
        role = "assistant" if msg.get("role") in ("assistant", "ai") else "user"
        content = msg.get("content", "").strip()
        if content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": query})

    client = get_async_client()
    try:
        response = await client.chat.completions.create(
            messages=messages,
            max_tokens=600,
            temperature=0.3,
        )
        reply = (
            response.choices[0].message.content
            if response.choices
            else "I could not generate an answer at this time."
        )
    except Exception as exc:
        reply = f"Error querying LLM: {str(exc)}"

    latency_ms = int((time.perf_counter() - t_start) * 1000)
    return {
        "reply": reply,
        "sources": [doc.filename],
        "latency_ms": latency_ms,
        "context_mode": "single_cv",
        "candidate_name": candidate_name,
        "cv_id": doc.id,
    }


async def _chat_with_all_cvs(
    docs: List[CVDocument],
    query: str,
    history: List[Dict[str, str]],
    t_start: float,
) -> Dict[str, Any]:
    """Generates an answer comparing or searching across all uploaded candidate CVs."""
    candidate_summaries = []
    sources = []

    for doc in docs:
        sources.append(doc.filename)
        structured = doc.structured_data or {}
        cand = structured.get("candidate", {})
        cand_name = cand.get("full_name") or doc.filename
        exp_years = structured.get("derived", {}).get("years_of_experience", "N/A")
        seniority = structured.get("derived", {}).get("seniority_level", "N/A")
        skills = ", ".join((structured.get("skills") or [])[:10])

        recent_role = "N/A"
        exps = structured.get("experience") or []
        if exps and isinstance(exps, list) and len(exps) > 0:
            recent_role = f"{exps[0].get('role', '')} at {exps[0].get('company', '')}"

        candidate_summaries.append(
            f"Candidate: {cand_name} (File: {doc.filename})\n"
            f"- Role: {recent_role}\n"
            f"- Experience: {exp_years} years | Seniority: {seniority}\n"
            f"- Top Skills: {skills}\n"
            f"- Location: {cand.get('location', 'N/A')} | Email: {cand.get('email', 'N/A')}"
        )

    all_candidates_context = "\n\n".join(candidate_summaries)

    system_prompt = (
        "You are an expert HR and Talent Acquisition Assistant with access to all candidates in the database. "
        "Answer comparative questions, talent searches, skill lookups, or profile comparisons based on the candidates below.\n"
        "Guidelines:\n"
        "1. Identify candidates clearly by name and filename.\n"
        "2. Compare skills, experience, and suitability objectively.\n"
        "3. Format answers cleanly using markdown bullet points or bold text.\n"
        "4. If no candidate matches a requested skill/role, say so explicitly.\n\n"
        f"--- CANDIDATES IN DATABASE ({len(docs)}) ---\n{all_candidates_context}\n-------------------------"
    )

    messages = [{"role": "system", "content": system_prompt}]

    for msg in (history or [])[-4:]:
        role = "assistant" if msg.get("role") in ("assistant", "ai") else "user"
        content = msg.get("content", "").strip()
        if content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": query})

    client = get_async_client()
    try:
        response = await client.chat.completions.create(
            messages=messages,
            max_tokens=800,
            temperature=0.3,
        )
        reply = (
            response.choices[0].message.content
            if response.choices
            else "I could not generate an answer at this time."
        )
    except Exception as exc:
        reply = f"Error querying LLM: {str(exc)}"

    latency_ms = int((time.perf_counter() - t_start) * 1000)
    return {
        "reply": reply,
        "sources": sources,
        "latency_ms": latency_ms,
        "context_mode": "all_cvs",
        "candidate_name": f"All Candidates ({len(docs)})",
        "cv_id": "all",
    }
