import json
import re
import asyncio
from huggingface_hub import AsyncInferenceClient, InferenceClient

try:
    from config import settings
except ImportError:
    from backend.config import settings

SYSTEM_PROMPT = """You are an expert HR Data Extractor. Extract relevant candidate CV data from the provided text into valid JSON matching this structure:
{
  "candidate": {
    "full_name": "Candidate Full Name or null",
    "email": "email@example.com or null",
    "phone": "+123456789 or null",
    "location": "City, Country or null",
    "links": []
  },
  "summary": "Summary text or null",
  "experience": [
    {
      "company": "Company Name",
      "role": "Job Title",
      "start_date": "YYYY or Month YYYY",
      "end_date": "YYYY or Present",
      "is_current": false,
      "description": "Role overview",
      "responsibilities": ["Task 1"],
      "skills_used": ["Skill 1"]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "role": "Role / Contributor",
      "description": "Project overview",
      "technologies": ["Tech 1", "Tech 2"],
      "link": "URL or null"
    }
  ],
  "education": [
    {
      "institution": "University Name",
      "degree": "Degree Title",
      "field_of_study": "Field",
      "start_date": "YYYY",
      "end_date": "YYYY",
      "gpa": "GPA or null"
    }
  ],
  "skills": ["Skill 1", "Skill 2"],
  "certifications": [
    {
      "name": "Cert Name",
      "issuer": "Issuer",
      "date_obtained": "YYYY"
    }
  ],
  "derived": {
    "years_of_experience": 0.0,
    "skills_count": 0,
    "seniority_level": "Senior / Mid / Junior",
    "top_skills": [],
    "management_experience": false
  },
  "inferred": {
    "inferred_skills": [],
    "leadership_traits": [],
    "communication_style": "Style description",
    "domain_expertise": []
  },
  "sections": [
    {
      "heading": "Section Heading",
      "content": "Content text"
    }
  ],
  "confidence_scores": {
    "overall": 0.90,
    "experience_dates": 0.85,
    "inferred_skills": 0.80
  }
}

RULES:
- Return ONLY valid JSON.
- CRITICAL - EXTRACT ALL WORK EXPERIENCES: You MUST extract EVERY SINGLE work experience item present across ALL pages of the resume. Do NOT omit, truncate, or summarize previous or older jobs. If there are 2, 3, 4, 5+ positions listed across pages, extract every distinct job into the "experience" array.
- CRITICAL - EXTRACT PROJECTS: If the candidate lists projects (client projects, personal projects, freelance work, portfolio), extract each one into the "projects" array with name, role, technologies, and description.
- Extract candidate name, email, phone, location, education, skills, and dynamic sections accurately.
- Keep descriptions and responsibilities concise (1-2 sentences per item) to maintain high data density.
"""

# Reusable singleton async client instance for HTTP/2 & connection keep-alive reuse
_async_client: AsyncInferenceClient | None = None


def get_async_client() -> AsyncInferenceClient:
    """Returns a shared AsyncInferenceClient for optimal connection pooling and throughput."""
    global _async_client
    if _async_client is None:
        _async_client = AsyncInferenceClient(
            model=settings.HUGGINGFACE_MODEL,
            token=settings.HUGGINGFACE_TOKEN if settings.HUGGINGFACE_TOKEN else None,
        )
    return _async_client


async def extract_chunk_json_async(chunk_text: str) -> dict:
    """Queries HuggingFace Serverless Inference API asynchronously using connection pooling."""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Extract Candidate CV Data:\n{chunk_text}"},
    ]

    client = get_async_client()
    try:
        response = await client.chat.completions.create(
            messages=messages,
            max_tokens=4000,
            temperature=0.1,
        )
        if response.choices and len(response.choices) > 0:
            raw_content = response.choices[0].message.content
            parsed = _parse_json_response(raw_content)
            if parsed and isinstance(parsed, dict):
                cand_name = (
                    parsed.get("candidate", {}).get("full_name")
                    if isinstance(parsed.get("candidate"), dict)
                    else None
                )
                skills_num = (
                    len(parsed.get("skills", []))
                    if isinstance(parsed.get("skills"), list)
                    else 0
                )
                exp_num = (
                    len(parsed.get("experience", []))
                    if isinstance(parsed.get("experience"), list)
                    else 0
                )
                proj_num = (
                    len(parsed.get("projects", []))
                    if isinstance(parsed.get("projects"), list)
                    else 0
                )
                print(f"[LLM Extractor] Extracted candidate: '{cand_name}' | Exp: {exp_num} | Proj: {proj_num} | Skills: {skills_num}")
                return parsed
            else:
                print(f"[LLM Extractor Warning] JSON parsing returned empty for raw length {len(raw_content or '')}")
    except Exception as err:
        err_msg = str(err)
        if "402" in err_msg or "depleted" in err_msg.lower() or "payment required" in err_msg.lower():
            print("\n[CRITICAL ERROR] HuggingFace API returned 402 Payment Required:")
            print("You have depleted your monthly free included credits for HUGGINGFACE_TOKEN.")
            print("Please update HUGGINGFACE_TOKEN in backend/.env with a fresh token.\n")
        else:
            safe_err = err_msg.encode("ascii", errors="replace").decode("ascii")
            print(f"[LLM Extractor Error] {safe_err[:200]}")

    return {}


def _extract_chunk_sync(chunk_text: str) -> dict:
    """Synchronous fallback wrapper for standalone scripts and non-async environments."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If in a running loop, create a new sync client as fallback
            sync_client = InferenceClient(
                model=settings.HUGGINGFACE_MODEL,
                token=settings.HUGGINGFACE_TOKEN if settings.HUGGINGFACE_TOKEN else None,
            )
            response = sync_client.chat.completions.create(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"Extract Candidate CV Data:\n{chunk_text}"},
                ],
                max_tokens=4000,
                temperature=0.1,
            )
            if response.choices and len(response.choices) > 0:
                return _parse_json_response(response.choices[0].message.content)
            return {}
        return loop.run_until_complete(extract_chunk_json_async(chunk_text))
    except Exception:
        return asyncio.run(extract_chunk_json_async(chunk_text))


async def extract_all_chunks_async(chunks: list[str]) -> list[dict]:
    """Queries LLM concurrently across all document text chunks using native async client."""
    tasks = [extract_chunk_json_async(chunk) for chunk in chunks]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return [r for r in results if isinstance(r, dict) and r]


def _parse_json_response(text: str) -> dict:
    """Parses text returned by the LLM into a Python dictionary with resilient repair."""
    if not text:
        return {}

    cleaned = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.MULTILINE)
    cleaned = re.sub(r"```$", "", cleaned.strip(), flags=re.MULTILINE).strip()

    start_idx = cleaned.find("{")
    end_idx = cleaned.rfind("}")
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        candidate_str = cleaned[start_idx : end_idx + 1]
    elif start_idx != -1:
        candidate_str = cleaned[start_idx:]
    else:
        candidate_str = cleaned

    # Attempt 1: Direct parse
    try:
        return json.loads(candidate_str, strict=False)
    except json.JSONDecodeError:
        pass

    # Attempt 2: Auto-repair unclosed braces/brackets if output was cut off
    try:
        repaired = candidate_str.rstrip()
        repaired = re.sub(r",\s*$", "", repaired)
        repaired = re.sub(r':\s*("[^"]*)?$', "", repaired)

        quotes_count = len(re.findall(r'(?<!\\)"', repaired))
        if quotes_count % 2 != 0:
            repaired += '"'

        open_braces = repaired.count("{") - repaired.count("}")
        open_brackets = repaired.count("[") - repaired.count("]")

        if open_brackets > 0:
            repaired += "]" * open_brackets
        if open_braces > 0:
            repaired += "}" * open_braces

        return json.loads(repaired, strict=False)
    except Exception as parse_err:
        print(f"[JSON Parser Note] Could not decode model output: {parse_err}")
        return {}
