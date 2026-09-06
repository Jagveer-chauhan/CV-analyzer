"""
Chat Service for CV Grounded RAG Assistant.

Handles conversational interactions with Gemma 3 LLM:
- Single-CV Mode: Answers specific questions grounded in one candidate's CV.
- All-CVs Mode: Answers cross-candidate queries, comparisons, and talent searches.
"""

from datetime import datetime
import time
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from models.db_models import CVDocument
from services.extractor import get_async_client
from services.merger import calculate_experience_breakdown


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
    """Generates a strictly grounded answer from a single candidate's CV using an enhanced RAG prompt."""
    structured = doc.structured_data or {}
    candidate_info = structured.get("candidate", {}) or {}
    candidate_name = candidate_info.get("full_name") or doc.filename
    now = datetime.now()
    today_str = now.strftime("%A, %B %d, %Y")
    current_year = now.year
    current_month = now.month

    # --- Build rich, complete context block ---
    ctx = []
    ctx.append(f"=== CANDIDATE PROFILE ===")
    ctx.append(f"Name        : {candidate_name}")
    ctx.append(f"Email       : {candidate_info.get('email', 'Not provided')}")
    ctx.append(f"Phone       : {candidate_info.get('phone', 'Not provided')}")
    ctx.append(f"Location    : {candidate_info.get('location', 'Not provided')}")

    links = candidate_info.get("links") or []
    if links:
        ctx.append(f"Links       : {' | '.join(links)}")

    summary = structured.get("summary")
    if summary:
        ctx.append(f"\n--- PROFESSIONAL SUMMARY ---\n{summary}")

    derived = structured.get("derived") or {}
    ctx.append(f"\n--- DERIVED METRICS ---")
    ctx.append(f"Total Years of Experience : {derived.get('years_of_experience', 'N/A')}")
    ctx.append(f"Seniority Level           : {derived.get('seniority_level', 'N/A')}")
    ctx.append(f"Skills Count              : {derived.get('skills_count', 'N/A')}")
    ctx.append(f"Management Experience     : {derived.get('management_experience', 'N/A')}")
    ctx.append(f"Top Skills                : {', '.join(derived.get('top_skills') or [])}")

    skills = structured.get("skills") or []
    if skills:
        ctx.append(f"\n--- ALL SKILLS ---\n{', '.join(skills)}")

    experiences = structured.get("experience") or []

    # --- SERVER-SIDE authoritative experience calculation (do not rely on LLM or stored JSON value) ---
    exp_breakdown = calculate_experience_breakdown(experiences)
    authoritative_total = exp_breakdown["total_label"]
    authoritative_years = exp_breakdown["total_years"]
    ref_date = exp_breakdown["reference_date"]

    if experiences:
        ctx.append(f"\n--- WORK EXPERIENCE ({len(experiences)} positions) ---")
        ctx.append(f"[SERVER-CALCULATED TOTAL: {authoritative_total} as of {ref_date}]")
        for i, exp in enumerate(experiences, 1):
            role = exp.get("role", "Unknown Role")
            company = exp.get("company", "Unknown Company")
            start = exp.get("start_date", "?")
            end = exp.get("end_date", "Present") if exp.get("is_current") else exp.get("end_date", "?")
            is_current_flag = "[CURRENT]" if exp.get("is_current") else ""
            # Find per-role calculation
            per_role_data = next((r for r in exp_breakdown["per_role"] if r["company"].lower() in company.lower() or company.lower() in r["company"].lower()), None)
            duration_str = f" | Duration: {per_role_data['years_str']}" if per_role_data else ""
            ctx.append(f"\n[{i}] {role} @ {company} | {start} → {end} {is_current_flag}{duration_str}".rstrip())
            desc = exp.get("description")
            if desc:
                ctx.append(f"    Description: {desc}")
            responsibilities = exp.get("responsibilities") or []
            if responsibilities:
                for r in responsibilities:
                    ctx.append(f"    • {r}")
            exp_skills = exp.get("skills_used") or []
            if exp_skills:
                ctx.append(f"    Skills Used: {', '.join(exp_skills)}")

    education = structured.get("education") or []
    if education:
        ctx.append(f"\n--- EDUCATION ({len(education)} entries) ---")
        for edu in education:
            deg = edu.get("degree", "Degree")
            field = edu.get("field_of_study", "")
            inst = edu.get("institution", "Institution")
            start = edu.get("start_date", "")
            end = edu.get("end_date", "")
            gpa = f" | GPA: {edu['gpa']}" if edu.get("gpa") else ""
            ctx.append(f"• {deg} in {field} — {inst} ({start}–{end}){gpa}")

    certifications = structured.get("certifications") or []
    if certifications:
        ctx.append(f"\n--- CERTIFICATIONS ({len(certifications)}) ---")
        for cert in certifications:
            ctx.append(f"• {cert.get('name', 'Cert')} | Issuer: {cert.get('issuer', 'N/A')} | Year: {cert.get('date_obtained', 'N/A')}")

    projects = structured.get("projects") or []
    if projects:
        ctx.append(f"\n--- PROJECTS ({len(projects)}) ---")
        for proj in projects:
            techs = ", ".join(proj.get("technologies") or [])
            ctx.append(f"• {proj.get('name', 'Project')}: {proj.get('description', '')} | Technologies: {techs}")

    inferred = structured.get("inferred") or {}
    if inferred.get("domain_expertise"):
        ctx.append(f"\n--- DOMAIN EXPERTISE ---\n{', '.join(inferred['domain_expertise'])}")
    if inferred.get("leadership_traits"):
        ctx.append(f"\n--- LEADERSHIP TRAITS ---\n{', '.join(inferred['leadership_traits'])}")

    context_str = "\n".join(ctx)

    system_prompt = (
        f"You are an expert HR Intelligence Assistant powered by a Retrieval-Augmented Generation (RAG) system.\n"
        f"Today's date: {today_str} (Year={current_year}, Month={current_month})\n\n"
        f"## INSTRUCTIONS\n"
        f"You are answering questions about ONE specific candidate using the structured CV data provided below.\n\n"
        f"### GROUNDING RULES (STRICT)\n"
        f"1. Base ALL answers exclusively on the candidate data in the CANDIDATE PROFILE section. Do NOT fabricate, infer beyond what is stated, or use external knowledge.\n"
        f"2. If the query asks about something not present in the CV, clearly state: 'This information is not mentioned in the candidate\u2019s CV.'\n"
        f"3. Quote or paraphrase CV content directly when relevant.\n\n"
        f"### EXPERIENCE & TENURE — USE PRE-COMPUTED VALUES (CRITICAL)\n"
        f"The server has already calculated ALL experience durations using Python with month-level precision.\n"
        f"These values are marked as [SERVER-CALCULATED TOTAL] and | Duration: ... | next to each role in the WORK EXPERIENCE section.\n"
        f"  - TOTAL EXPERIENCE: {authoritative_total} (as of {ref_date}) = {authoritative_years} years\n"
        f"  - DO NOT recalculate, estimate, or override these values. Use them as GROUND TRUTH.\n"
        f"  - When asked 'how many years of experience?', answer: '{authoritative_total}' directly from the pre-computed value.\n"
        f"  - When asked about a specific role's tenure, read the | Duration: ... | value next to that role entry.\n\n"
        f"### QUERY TYPES — HOW TO ANSWER\n"
        f"- **Factual lookup** (e.g. 'What is their email?'): Extract directly from profile, one sentence.\n"
        f"- **Experience/tenure** (e.g. 'How many years of experience?'): Use the SERVER-CALCULATED TOTAL: {authoritative_total}. List per-role durations from the Duration values.\n"
        f"- **Skill/fit assessment** (e.g. 'Is this person good for a Python role?'): List matching skills/experience from CV, then give a grounded conclusion.\n"
        f"- **Comparison** (e.g. 'What is their strongest area?'): Cite specific CV entries, then summarize.\n"
        f"- **Unknown** (e.g. 'What is their GPA?'): Search the EDUCATION section first, then certifications, then state 'Not mentioned' if absent.\n\n"
        f"### OUTPUT FORMAT\n"
        f"- Use clear markdown: bold for labels, bullet points for lists.\n"
        f"- For calculations, show step-by-step working before the final answer.\n"
        f"- Be concise and professional. Avoid repetition.\n\n"
        f"{context_str}"
    )

    messages = [{"role": "system", "content": system_prompt}]
    for msg in (history or [])[-6:]:
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
            temperature=0.1,
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
    """Generates a comparative or talent-search answer across all candidate CVs using an enhanced RAG prompt."""
    now = datetime.now()
    today_str = now.strftime("%A, %B %d, %Y")
    current_year = now.year
    current_month = now.month
    sources = []
    candidate_blocks = []

    for doc in docs:
        sources.append(doc.filename)
        structured = doc.structured_data or {}
        cand = structured.get("candidate") or {}
        cand_name = cand.get("full_name") or doc.filename
        derived = structured.get("derived") or {}
        seniority = derived.get("seniority_level", "N/A")
        management = derived.get("management_experience", False)
        skills = structured.get("skills") or []
        top_skills = derived.get("top_skills") or skills[:5]

        # SERVER-SIDE authoritative experience calculation
        exps = structured.get("experience") or []
        bd = calculate_experience_breakdown(exps)
        authoritative_exp_label = bd["total_label"]
        authoritative_exp_years = bd["total_years"]

        exp_lines = []
        for exp in exps:
            start = exp.get("start_date", "?")
            end = exp.get("end_date", "Present") if exp.get("is_current") else exp.get("end_date", "?")
            current_flag = " [CURRENT]" if exp.get("is_current") else ""
            company = exp.get("company", "?")
            per_role_data = next((r for r in bd["per_role"] if r["company"].lower() in company.lower() or company.lower() in r["company"].lower()), None)
            dur = f" | {per_role_data['years_str']}" if per_role_data else ""
            exp_lines.append(f"    • {exp.get('role','?')} @ {company} ({start}→{end}){current_flag}{dur}")

        edu_lines = []
        for edu in (structured.get("education") or [])[:2]:
            edu_lines.append(f"    • {edu.get('degree','?')} in {edu.get('field_of_study','')} — {edu.get('institution','?')} ({edu.get('end_date','')})")

        certs = structured.get("certifications") or []
        cert_line = ", ".join(c.get("name", "") for c in certs[:4]) if certs else "None"

        projects = structured.get("projects") or []
        proj_line = ", ".join(p.get("name", "") for p in projects[:3]) if projects else "None"

        inferred = structured.get("inferred") or {}
        domain = ", ".join(inferred.get("domain_expertise") or [])

        block = (
            f"--- CANDIDATE: {cand_name} (File: {doc.filename}) ---\n"
            f"  Location     : {cand.get('location', 'N/A')} | Email: {cand.get('email', 'N/A')}\n"
            f"  Total Exp    : {authoritative_exp_label} ({authoritative_exp_years} yrs) [SERVER-COMPUTED] | Seniority: {seniority} | Management: {management}\n"
            f"  Top Skills   : {', '.join(top_skills)}\n"
            f"  All Skills   : {', '.join(skills[:20])}{'...' if len(skills) > 20 else ''}\n"
            f"  Domain       : {domain or 'N/A'}\n"
            f"  Certifications: {cert_line}\n"
            f"  Notable Projects: {proj_line}\n"
            f"  Work History :\n" + "\n".join(exp_lines) + "\n"
            f"  Education    :\n" + "\n".join(edu_lines)
        )
        candidate_blocks.append(block)

    all_context = "\n\n".join(candidate_blocks)

    system_prompt = (
        f"You are an expert HR Intelligence Assistant powered by a Retrieval-Augmented Generation (RAG) system.\n"
        f"Today's date: {today_str} (Year={current_year}, Month={current_month})\n"
        f"You have access to a database of {len(docs)} candidate CVs structured below.\n\n"
        f"## INSTRUCTIONS\n\n"
        f"### GROUNDING RULES (STRICT)\n"
        f"1. Base ALL answers exclusively on the candidate data provided. Do NOT fabricate skills, roles, dates, or attributes not present in the data.\n"
        f"2. Identify candidates by their name AND filename to avoid confusion.\n"
        f"3. If no candidate matches a query criterion, explicitly state: 'No candidate in the database matches this criterion.'\n"
        f"4. For partial matches, list the closest matches and explain what they have vs. what was asked.\n\n"
        f"### EXPERIENCE — USE PRE-COMPUTED VALUES (CRITICAL)\n"
        f"Each candidate's Total Exp is marked [SERVER-COMPUTED] using Python month-precision arithmetic.\n"
        f"  - DO NOT recalculate experience totals. The [SERVER-COMPUTED] values are GROUND TRUTH.\n"
        f"  - When comparing experience, use the exact values shown next to each candidate.\n"
        f"  - Per-role durations are shown inline as | X yr Y mo | next to each work history entry.\n\n"
        f"### QUERY TYPES — HOW TO RESPOND\n"
        f"- **Talent search** (e.g. 'Who knows React?'): Scan ALL skills fields for each candidate, rank by relevance/depth, list matches with evidence.\n"
        f"- **Ranking** (e.g. 'Most experienced?'): Use Total Exp years. Show the values for each candidate, then rank.\n"
        f"- **Comparison** (e.g. 'Compare A vs B on Python'): Create a structured side-by-side for the requested dimension.\n"
        f"- **Seniority/role fit** (e.g. 'Who is best for a senior backend role?'): Check seniority level, domain, years, current role, and management experience.\n"
        f"- **Count/stats** (e.g. 'How many have AWS?'): Scan all candidates systematically and give exact count with names.\n\n"
        f"### OUTPUT FORMAT\n"
        f"- Use markdown tables for comparisons, bullet lists for candidate summaries.\n"
        f"- Always cite candidate name + filename when referencing data.\n"
        f"- For calculations, show the working clearly before the conclusion.\n"
        f"- Be concise, factual, and structured.\n\n"
        f"=== CANDIDATE DATABASE ({len(docs)} candidates) ===\n{all_context}"
    )

    messages = [{"role": "system", "content": system_prompt}]
    for msg in (history or [])[-6:]:
        role = "assistant" if msg.get("role") in ("assistant", "ai") else "user"
        content = msg.get("content", "").strip()
        if content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": query})

    client = get_async_client()
    try:
        response = await client.chat.completions.create(
            messages=messages,
            max_tokens=1000,
            temperature=0.1,
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
