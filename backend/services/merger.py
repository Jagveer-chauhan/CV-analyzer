import re
from datetime import datetime
from typing import Any, Dict, List


def merge_chunk_extractions(chunk_jsons: List[Dict[str, Any]], raw_text: str) -> Dict[str, Any]:
    """
    Intelligently merges partial JSON extractions from multiple document chunks.
    Overwrites scalar fields, deduplicates work experience, education, skills,
    certifications, and dynamic sections across chunk boundaries.
    """
    merged_candidate: Dict[str, Any] = {}
    merged_summary: str = ""
    merged_experience: List[Dict[str, Any]] = []
    merged_projects: List[Dict[str, Any]] = []
    merged_education: List[Dict[str, Any]] = []
    merged_skills: List[str] = []
    merged_certifications: List[Dict[str, Any]] = []
    merged_derived: Dict[str, Any] = {}
    merged_inferred: Dict[str, Any] = {
        "inferred_skills": [],
        "leadership_traits": [],
        "communication_style": None,
        "domain_expertise": [],
    }
    merged_sections: List[Dict[str, Any]] = []
    merged_confidence: Dict[str, float] = {
        "overall": 0.90,
        "experience_dates": 0.85,
        "inferred_skills": 0.80,
    }

    for item in chunk_jsons:
        if not isinstance(item, dict):
            continue

        # 1. Candidate Info
        candidate_data = item.get("candidate")
        if isinstance(candidate_data, dict):
            for k, v in candidate_data.items():
                if v and (k not in merged_candidate or not merged_candidate[k]):
                    merged_candidate[k] = v

        # 2. Summary
        summary_val = item.get("summary")
        if isinstance(summary_val, str) and len(summary_val) > len(merged_summary):
            merged_summary = summary_val

        # 3. Experience (Deduplicate distinct roles without dropping multi-company positions)
        exp_list = item.get("experience")
        if isinstance(exp_list, list):
            for exp in exp_list:
                if isinstance(exp, dict):
                    _merge_experience_item(merged_experience, exp)

        # 4. Projects
        proj_list = item.get("projects")
        if isinstance(proj_list, list):
            for proj in proj_list:
                if isinstance(proj, dict):
                    _merge_project_item(merged_projects, proj)

        # 5. Education
        edu_list = item.get("education")
        if isinstance(edu_list, list):
            for edu in edu_list:
                if isinstance(edu, dict):
                    _merge_education_item(merged_education, edu)

        # 6. Skills
        skills_list = item.get("skills")
        if isinstance(skills_list, list):
            for skill in skills_list:
                if isinstance(skill, str) and skill.strip():
                    clean_s = skill.strip()
                    if clean_s not in merged_skills:
                        merged_skills.append(clean_s)

        # 7. Certifications
        cert_list = item.get("certifications")
        if isinstance(cert_list, list):
            for cert in cert_list:
                if isinstance(cert, dict):
                    _merge_certification_item(merged_certifications, cert)

        # 8. Derived & Inferred
        derived_data = item.get("derived")
        if isinstance(derived_data, dict):
            for k, v in derived_data.items():
                if v and (k not in merged_derived or not merged_derived[k]):
                    merged_derived[k] = v

        inferred_data = item.get("inferred")
        if isinstance(inferred_data, dict):
            for k, v in inferred_data.items():
                if isinstance(v, list):
                    for item_v in v:
                        if item_v not in merged_inferred.setdefault(k, []):
                            merged_inferred[k].append(item_v)
                elif v and not merged_inferred.get(k):
                    merged_inferred[k] = v

        # 9. Dynamic Sections
        sections_list = item.get("sections")
        if isinstance(sections_list, list):
            for sec in sections_list:
                if isinstance(sec, dict) and sec.get("heading"):
                    _merge_section_item(merged_sections, sec)

    # Calculate Derived Metrics if missing
    calculated_years = _calculate_years_of_experience(merged_experience)
    merged_derived["years_of_experience"] = max(
        merged_derived.get("years_of_experience", 0.0) or 0.0, calculated_years
    )
    merged_derived["skills_count"] = len(merged_skills)
    if not merged_derived.get("top_skills"):
        merged_derived["top_skills"] = merged_skills[:5]

    return {
        "candidate": merged_candidate,
        "summary": merged_summary if merged_summary else None,
        "experience": merged_experience,
        "projects": merged_projects,
        "education": merged_education,
        "skills": merged_skills,
        "certifications": merged_certifications,
        "derived": merged_derived,
        "inferred": merged_inferred,
        "sections": merged_sections,
        "raw_text": raw_text,
        "confidence_scores": merged_confidence,
    }


def _merge_experience_item(exp_list: List[Dict[str, Any]], new_exp: Dict[str, Any]):
    """Helper to deduplicate and merge work experience entries across chunks."""
    company = (new_exp.get("company") or "").strip().lower()
    role = (new_exp.get("role") or "").strip().lower()

    for existing in exp_list:
        ex_company = (existing.get("company") or "").strip().lower()
        ex_role = (existing.get("role") or "").strip().lower()

        # Only merge as same experience if the company matches
        # (NEVER merge different companies just because roles have similar titles!)
        company_matches = bool(
            company and ex_company and (company == ex_company or company in ex_company or ex_company in company)
        )

        if company_matches:
            # Merge responsibilities & skills
            new_resp = new_exp.get("responsibilities") or []
            if isinstance(new_resp, list):
                existing_resp = existing.setdefault("responsibilities", [])
                for r in new_resp:
                    if r not in existing_resp:
                        existing_resp.append(r)

            new_skills = new_exp.get("skills_used") or []
            if isinstance(new_skills, list):
                existing_skills = existing.setdefault("skills_used", [])
                for s in new_skills:
                    if s not in existing_skills:
                        existing_skills.append(s)

            # Preserve dates & description if missing
            for field in ("role", "start_date", "end_date", "description"):
                if not existing.get(field) and new_exp.get(field):
                    existing[field] = new_exp[field]
            return

    # If different company, append as a distinct role!
    exp_list.append(new_exp)


def _merge_project_item(proj_list: List[Dict[str, Any]], new_proj: Dict[str, Any]):
    """Helper to deduplicate and merge project entries across chunks."""
    name = (new_proj.get("name") or "").strip().lower()
    if not name:
        if new_proj.get("description"):
            proj_list.append(new_proj)
        return

    for existing in proj_list:
        ex_name = (existing.get("name") or "").strip().lower()
        if name == ex_name or (name and ex_name and (name in ex_name or ex_name in name)):
            # Merge technologies
            new_tech = new_proj.get("technologies") or []
            if isinstance(new_tech, list):
                ex_tech = existing.setdefault("technologies", [])
                for t in new_tech:
                    if t not in ex_tech:
                        ex_tech.append(t)

            for field in ("role", "description", "link", "start_date", "end_date"):
                if not existing.get(field) and new_proj.get(field):
                    existing[field] = new_proj[field]
            return

    proj_list.append(new_proj)


def _merge_education_item(edu_list: List[Dict[str, Any]], new_edu: Dict[str, Any]):
    """Helper to deduplicate education entries across chunks."""
    inst = (new_edu.get("institution") or "").strip().lower()
    deg = (new_edu.get("degree") or "").strip().lower()

    for existing in edu_list:
        ex_inst = (existing.get("institution") or "").strip().lower()
        if inst and ex_inst and inst in ex_inst:
            for field in ("degree", "field_of_study", "start_date", "end_date", "gpa"):
                if not existing.get(field) and new_edu.get(field):
                    existing[field] = new_edu[field]
            return

    edu_list.append(new_edu)


def _merge_certification_item(cert_list: List[Dict[str, Any]], new_cert: Dict[str, Any]):
    """Helper to deduplicate certifications across chunks."""
    name = (new_cert.get("name") or "").strip().lower()
    for existing in cert_list:
        ex_name = (existing.get("name") or "").strip().lower()
        if name and ex_name and name in ex_name:
            return
    cert_list.append(new_cert)


def _merge_section_item(sec_list: List[Dict[str, Any]], new_sec: Dict[str, Any]):
    """Helper to merge dynamic sections."""
    heading = (new_sec.get("heading") or "").strip().lower()
    for existing in sec_list:
        ex_heading = (existing.get("heading") or "").strip().lower()
        if heading and ex_heading and heading == ex_heading:
            existing["content"] += f"\n{new_sec.get('content', '')}"
            return
    sec_list.append(new_sec)


def _calculate_years_of_experience(exp_list: List[Dict[str, Any]]) -> float:
    """Calculates approximate total years of experience from experience date ranges."""
    total_months = 0
    year_pattern = re.compile(r"\b(19\d{2}|20\d{2})\b")
    current_year = datetime.now().year

    for exp in exp_list:
        start_str = str(exp.get("start_date") or "")
        end_str = str(exp.get("end_date") or "")

        start_years = year_pattern.findall(start_str)
        end_years = year_pattern.findall(end_str)

        if start_years:
            s_year = int(start_years[0])
            e_year = int(end_years[0]) if end_years else current_year
            diff = max(0, e_year - s_year)
            total_months += diff * 12

    return round(total_months / 12.0, 1)
