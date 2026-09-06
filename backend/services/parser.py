import io
import pymupdf as fitz
import docx


def extract_text_from_bytes(file_bytes: bytes, filename: str) -> str:
    """Extract raw text from PDF, DOCX, or TXT file bytes directly in memory."""
    filename_lower = filename.lower()

    if filename_lower.endswith(".pdf"):
        return _extract_from_pdf(file_bytes)
    elif filename_lower.endswith(".docx") or filename_lower.endswith(".doc"):
        return _extract_from_docx(file_bytes)
    else:
        return _extract_from_txt(file_bytes)


def _extract_from_pdf(file_bytes: bytes) -> str:
    """Extract multi-page text from PDF bytes using PyMuPDF."""
    text_parts = []
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        page_text = page.get_text("text").strip()
        if page_text:
            text_parts.append(f"--- Page {page_num + 1} ---\n{page_text}")
    doc.close()
    return "\n\n".join(text_parts)


def _extract_from_docx(file_bytes: bytes) -> str:
    """Extract text and table content from DOCX bytes using python-docx."""
    text_parts = []
    doc_stream = io.BytesIO(file_bytes)
    doc = docx.Document(doc_stream)

    for paragraph in doc.paragraphs:
        if paragraph.text.strip():
            text_parts.append(paragraph.text.strip())

    for table in doc.tables:
        for row in table.rows:
            row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
            if row_text:
                text_parts.append(row_text)

    return "\n".join(text_parts)


def _extract_from_txt(file_bytes: bytes) -> str:
    """Extract text from TXT bytes trying common encodings."""
    for encoding in ("utf-8", "utf-8-sig", "latin-1", "cp1252"):
        try:
            return file_bytes.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
    return file_bytes.decode("utf-8", errors="ignore").strip()


def chunk_text(raw_text: str, max_chunk_tokens: int = 3500, overlap_tokens: int = 300) -> list[str]:
    """
    Splits multi-page text into contextual chunks (~3500 words) with overlap (~300 words).
    Allows multi-page CVs (up to 5-6 pages) to be processed comprehensively without splitting key sections.
    """
    words = raw_text.split()
    if len(words) <= max_chunk_tokens:
        return [raw_text]

    chunks = []
    step = max_chunk_tokens - overlap_tokens
    for i in range(0, len(words), step):
        chunk_words = words[i : i + max_chunk_tokens]
        chunk_str = " ".join(chunk_words)
        chunks.append(chunk_str)
        if i + max_chunk_tokens >= len(words):
            break

    return chunks
