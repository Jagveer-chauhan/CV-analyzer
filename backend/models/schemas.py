from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class TimingMs(BaseModel):
    text_extraction: int = 0
    chunking: int = 0
    llm_extraction: int = 0
    validation: int = 0
    merge: int = 0
    embedding: int = 0
    vector_upsert: int = 0
    rag_verification: int = 0
    total_processing: int = 0

    model_config = ConfigDict(extra="allow")


class ProcessingMetadata(BaseModel):
    request_id: str = ""
    model: str = "google/gemma-3-4b-it"
    status: str = "rag_ready"
    upload_accepted_at: str = ""
    rag_ready_at: str = ""
    timing_ms: TimingMs = Field(default_factory=TimingMs)
    cold_start: bool = False
    chunks_used: int = 1
    retry_count: int = 0

    model_config = ConfigDict(extra="allow")


class Candidate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    links: List[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="allow")


class ExperienceItem(BaseModel):
    company: Optional[str] = None
    role: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_current: bool = False
    description: Optional[str] = None
    responsibilities: List[str] = Field(default_factory=list)
    skills_used: List[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="allow")


class EducationItem(BaseModel):
    institution: Optional[str] = None
    degree: Optional[str] = None
    field_of_study: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    gpa: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class CertificationItem(BaseModel):
    name: Optional[str] = None
    issuer: Optional[str] = None
    date_obtained: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class DerivedData(BaseModel):
    years_of_experience: float = 0.0
    skills_count: int = 0
    seniority_level: Optional[str] = None
    top_skills: List[str] = Field(default_factory=list)
    management_experience: bool = False

    model_config = ConfigDict(extra="allow")


class InferredData(BaseModel):
    inferred_skills: List[str] = Field(default_factory=list)
    leadership_traits: List[str] = Field(default_factory=list)
    communication_style: Optional[str] = None
    domain_expertise: List[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="allow")


class ProjectItem(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    description: Optional[str] = None
    technologies: List[str] = Field(default_factory=list)
    link: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class SectionItem(BaseModel):
    heading: str
    content: str

    model_config = ConfigDict(extra="allow")


class ConfidenceScores(BaseModel):
    overall: float = 0.90
    experience_dates: float = 0.85
    inferred_skills: float = 0.80

    model_config = ConfigDict(extra="allow")


class CVStructuredDocument(BaseModel):
    """Top-level fixed contract for structured CV data."""
    candidate: Candidate = Field(default_factory=Candidate)
    summary: Optional[str] = None
    experience: List[ExperienceItem] = Field(default_factory=list)
    projects: List[ProjectItem] = Field(default_factory=list)
    education: List[EducationItem] = Field(default_factory=list)
    skills: List[str] = Field(default_factory=list)
    certifications: List[CertificationItem] = Field(default_factory=list)
    derived: DerivedData = Field(default_factory=DerivedData)
    inferred: InferredData = Field(default_factory=InferredData)
    sections: List[SectionItem] = Field(default_factory=list)
    raw_text: str = ""
    confidence_scores: ConfidenceScores = Field(default_factory=ConfidenceScores)
    processing_metadata: ProcessingMetadata = Field(default_factory=ProcessingMetadata)


class ChatMessage(BaseModel):
    role: str
    content: str

    model_config = ConfigDict(extra="allow")


class ChatRequest(BaseModel):
    query: str
    cv_id: Optional[str] = None  # None or "all" for entire knowledge base
    history: List[ChatMessage] = Field(default_factory=list)

    model_config = ConfigDict(extra="allow")


class ChatResponse(BaseModel):
    reply: str
    sources: List[str] = Field(default_factory=list)
    latency_ms: int = 0
    context_mode: str = "single_cv"
    candidate_name: Optional[str] = None
    cv_id: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class BulkDeleteRequest(BaseModel):
    cv_ids: List[str] = Field(..., min_length=1, description="List of CV IDs to delete")

    model_config = ConfigDict(extra="allow")


class BulkDeleteResponse(BaseModel):
    message: str
    deleted_count: int
    deleted_ids: List[str]

    model_config = ConfigDict(extra="allow")

