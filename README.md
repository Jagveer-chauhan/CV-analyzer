# RAG CV Ingestion & Talent Intelligence System

A production-ready, full-stack AI platform for **multi-page CV ingestion, structured entity extraction using Google Gemma 3, Supabase PostgreSQL persistence, and interactive dual-mode RAG talent chat**.

Engineered with in-memory parsing (PyMuPDF & python-docx), page-aware chunking, deduplication and merging algorithms, real-time SLA metrics tracking, and prompt injection defense guardrails.

---

## 🏗️ System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               React 18 + Vite Modern UI                                 │
│  ┌─────────────────────────┬─────────────────────────┬───────────────────────────────┐  │
│  │ 1. Document Navigator   │ 2. AI Chat Studio       │ 3. Candidate Intelligence     │  │
│  │    • Drag & Drop Upload │    • Single CV Mode     │    • Profile & Experience     │  │
│  │    • 10MB Client Checks │    • All CVs Search     │    • Key Projects List        │  │
│  │    • Candidate Selector │    • Real-time Latency  │    • SLA Metrics & JSON Tree  │  │
│  └─────────────────────────┴─────────────────────────┴───────────────────────────────┘  │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ HTTP / JSON (VITE_API_BASE_URL)
┌───────────────────────────────────────────▼─────────────────────────────────────────────┐
│                             FastAPI Backend Service (Python 3.11)                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Security & Ingestion Pipeline:                                                    │  │
│  │  1. Streamed 10MB size limit (HTTP 413) & Magic-byte header verification (%PDF, PK)│  │
│  │  2. In-memory text extraction via PyMuPDF / python-docx (zero disk overhead)      │  │
│  │  3. Page-aware token chunking (3500 words / 300 overlap)                          │  │
│  │  4. Async LLM Extraction via Gemma 3 (google/gemma-3-4b-it on Hugging Face API)   │  │
│  │  5. JSON Deduplication & Multi-Page Experience/Project Merge Engine               │  │
│  │  6. Non-blocking threadpool database persistence (asyncio.to_thread)              │  │
│  └───────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────┬──────────────────────────────┬────────────────────┘
                                      │                              │
                                      ▼                              ▼
                 ┌───────────────────────────────┐     ┌───────────────────────────────┐
                 │    Hugging Face Inference     │     │      Supabase PostgreSQL      │
                 │    (Google Gemma 3 4B IT)     │     │    cv_documents (JSONB + Idx) │
                 └───────────────────────────────┘     └───────────────────────────────┘
```

---

## ✨ Core Features & Functionality

### 1. In-Memory Multi-Page Document Ingestion
- Supports **PDF**, **DOCX**, **DOC**, and **TXT** resumes.
- Files are parsed purely in-memory using **PyMuPDF (`fitz`)** and **`python-docx`** — no temporary files written to disk.
- Page markers (`--- Page X ---`) preserve multi-page resume boundaries and chronology.

### 2. High-Density Structured Extraction with Google Gemma 3
- Extracts comprehensive structured profiles adhering to strict Pydantic schemas:
  - **Candidate Contact**: Full name, email, phone, location, portfolio links.
  - **Work Experience**: Extracts **every distinct job** across all pages with start/end dates, current status, company, role, descriptions, responsibilities, and skills used.
  - **Key Projects**: Extracts client projects, personal work, and open-source contributions with role, technologies, descriptions, and URLs.
  - **Education & Certifications**: Degrees, institutions, graduation dates, GPA, and professional certifications.
  - **Derived Analytics**: Total years of experience, primary skills, and seniority level (`Junior`, `Mid`, `Senior`, `Lead`).
  - **Inferred Soft Skills & Traits**: Leadership qualities, domain expertise, and communication style.

### 3. Dual-Mode Grounded AI Chat Studio
- **Single Candidate Mode**: Focus on an individual resume to ask specific questions (e.g., *"What projects did Jagveer lead?"*, *"Verify start and end dates at previous employers"*).
- **All Candidates (Knowledge Base) Mode**: Cross-candidate comparative search across the database (e.g., *"Who has 4+ years of Python and FastAPI experience?"*, *"Rank candidates by backend seniority"*).
- Real-time response latency tracking (ms) and cited sources for every message.

### 4. Real-Time SLA Tracking Dashboard
- Measures and reports execution timings for every ingestion stage:
  - Text Extraction SLA (ms)
  - Page-Aware Chunking SLA (ms)
  - Hugging Face Gemma LLM Inference SLA (ms)
  - Deduplication & Schema Merge SLA (ms)
  - Total End-to-End Processing SLA (ms)

### 5. Premium Equalized 3-Column Light UI
- Equalized **1:1:1** column proportion with clean modern light aesthetics:
  - **Section 1 (Left)**: Upload zone with drag-and-drop + Candidate library with active selection indicator and deletion actions.
  - **Section 2 (Middle)**: Interactive chat stream with assistant avatars, formatted markdown lists/bold text, and suggestion chips.
  - **Section 3 (Right)**: Candidate intelligence tabs (formatted resume profile with contact chips, work history timeline, project pills, copyable JSON tree, and SLA metrics).

---

## 🛡️ Security Guardrails & Hardening (Without Auth)

The system incorporates enterprise-grade defensive protections while remaining frictionless for local and cloud testing without requiring logins or API keys:

1. **Upload DoS & Payload Limits**:
   - Streaming file size enforcement capped at **10MB**; uploads exceeding 10MB are aborted immediately with `413 Payload Too Large`.
   - File extension whitelisting (`.pdf`, `.docx`, `.doc`, `.txt`).
   - Magic-byte verification checking for authentic PDF headers (`%PDF`) and Word OpenXML ZIP archives (`PK\x03\x04`), while blocking executable binaries (`MZ`, `\x7fELF`).
   - Filename sanitization stripping path traversal characters (`../`, `..\`) and null bytes.
2. **Prompt Injection & System Prompt Leaking Defenses**:
   - Structured XML-style tag isolation (`<untrusted_candidate_document>`, `<candidate_knowledge_base>`, `<user_query>`).
   - Anti-injection system directives instructing Gemma to treat resume content strictly as passive data and reject prompt overrides.
   - Deterministic post-generation response sanitization scrubbing leaked tags or system prompt echoes before returning replies to users.
   - Chat history sanitization restricting roles strictly to `'user'` and `'assistant'` and capping turns to prevent context stuffing attacks.
3. **Concurrency & Event-Loop Protection**:
   - Offloads synchronous Supabase database queries (`db.commit()`, `db.refresh()`) and CPU-bound parsing to worker threads via `asyncio.to_thread` to keep FastAPI's async event loop free.
   - Query performance index added to `CVDocument.created_at`.
4. **Client-Side Pre-Flight Validation**:
   - React drag-and-drop and file input check file size (<10MB) and extensions client-side before sending network requests.

---

## 📡 API Endpoints Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Informative API overview, service status, and feature metadata |
| `GET` | `/api/status` | Real-time health check (FastAPI backend, Supabase DB, Gemma LLM) |
| `POST` | `/api/v1/cvs/upload` | Ingests and processes single or multiple CV files (multipart/form-data) |
| `GET` | `/api/v1/cvs` | Lists all stored candidate CVs with extracted profile summaries |
| `GET` | `/api/v1/cvs/{cv_id}` | Retrieves full structured data and raw text for a specific candidate |
| `DELETE` | `/api/v1/cvs/{cv_id}` | Deletes a candidate CV document from the database |
| `POST` | `/api/v1/cvs/chat` | AI chat query grounded in a single CV or across all CVs |
| `GET` | `/docs` | Interactive Swagger UI API documentation |
| `GET` | `/redoc` | ReDoc API documentation |

---

## 🚀 Deployment on Render (render.com)

The repository is configured to deploy as **2 instances** on Render using **1 single Dockerfile**:
1. **Backend Web Service (`cv-rag-backend`)**: Built using the root [`Dockerfile`](./Dockerfile) (Python 3.11-slim + PyMuPDF + Uvicorn).
2. **Frontend Static Site (`cv-rag-frontend`)**: Deployed natively as a Render Static Site (`cd frontend && npm install && npm run build` -> `./frontend/dist`) on Render's global CDN for **free**.

### One-Click Deploy via Render Blueprint

1. Push this repository to your GitHub account:
   ```bash
   git add .
   git commit -m "Deploy RAG system to Render"
   git push origin main
   ```
2. Open [dashboard.render.com](https://dashboard.render.com).
3. Click **New +** ➔ **Blueprint**.
4. Select your repository. Render will read [`render.yaml`](./render.yaml) and automatically detect both services:
   - `cv-rag-backend` (Docker Web Service)
   - `cv-rag-frontend` (Static Site)
5. Fill in the required environment variables:
   - `DATABASE_URL`: Your Supabase PostgreSQL connection string
   - `HUGGINGFACE_TOKEN`: Your Hugging Face user access token (`hf_...`)
   - `HUGGINGFACE_MODEL`: `google/gemma-3-4b-it`
   - `ALLOWED_ORIGINS`: `*`
6. Click **Apply** — Render provisions and builds both instances automatically!

---

## 💻 Local Development Setup

### 1. Prerequisites
- Python 3.11+
- Node.js 18+ and npm
- A free Supabase PostgreSQL database
- A free Hugging Face API token

### 2. Backend Setup (FastAPI)

```bash
cd backend

# Create virtual environment
python -m venv .venv

# Activate virtual environment
# Windows (PowerShell):
.\.venv\Scripts\Activate.ps1
# Linux / macOS:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# Edit .env and enter your DATABASE_URL and HUGGINGFACE_TOKEN

# Start development server
uvicorn main:app --reload --port 8000
```
- API is live at `http://127.0.0.1:8000`
- Interactive Swagger docs at `http://127.0.0.1:8000/docs`
- Health check at `http://127.0.0.1:8000/api/status`

### 3. Frontend Setup (React + Vite)

In a new terminal:
```bash
cd frontend

# Install Node dependencies
npm install

# Start Vite dev server
npm run dev
```
- Frontend UI is live at `http://localhost:5173`
- Proxies `/api` requests directly to backend on `http://127.0.0.1:8000`

---

## 📁 Repository Structure

```text
├── Dockerfile                  # Production Dockerfile for Render backend service
├── render.yaml                 # Render Blueprint (backend web service + frontend static site)
├── .dockerignore               # Prevents copying virtual environments, node_modules, and secrets
├── .env.example                # Template for environment variables
├── README.md                   # Complete system documentation
├── backend/
│   ├── config.py               # Settings loader (DATABASE_URL, HF tokens, CORS)
│   ├── database.py             # SQLAlchemy connection pool & Supabase connection checker
│   ├── llm.py                  # Gemma 3 connectivity test utility
│   ├── main.py                 # FastAPI application, CORS middleware & health endpoints
│   ├── requirements.txt        # Backend dependencies (FastAPI, PyMuPDF, SQLAlchemy, etc.)
│   ├── models/
│   │   ├── db_models.py        # SQLAlchemy CVDocument model (with created_at index)
│   │   └── schemas.py          # Pydantic schemas (CVStructuredDocument, ProjectItem, TimingMs)
│   ├── routers/
│   │   └── cv.py               # Upload, parse, list, get, delete, and chat endpoints
│   └── services/
│       ├── parser.py           # In-memory PyMuPDF & python-docx text extractor and chunker
│       ├── extractor.py        # Async Gemma 3 LLM extractor with boundary fencing
│       ├── merger.py           # Deduplication and multi-page experience/project merge logic
│       └── chat.py             # Dual-mode RAG chat engine with prompt injection defense
└── frontend/
    ├── index.html              # HTML shell with Google Fonts
    ├── package.json            # React 18, Vite, and build scripts
    ├── vite.config.js          # Vite config with dev proxy to backend:8000
    └── src/
        ├── App.jsx             # 3-column UI (Navigator, AI Chat Studio, Candidate Intelligence)
        ├── main.jsx            # React root mount
        └── index.css           # Modern light theme, typography, cards & micro-animations
```

---

## 📄 License
MIT License. Built for high-performance AI resume intelligence and recruitment workflows.
