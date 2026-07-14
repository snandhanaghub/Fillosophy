"""
routes/extract.py — Fillosophy FastAPI Backend

Handles resume file uploads, AI-powered profile extraction, and DB persistence.

POST /extract
    Accepts a PDF resume and a profile name, extracts all readable text
    via pdfplumber, runs Claude AI extraction to produce a structured
    profile dict, saves it to the active database backend, and returns
    the full result.
"""

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from database.profiles import save_profile
from utils.ai_client import extract_profile_from_text
from utils.pdf_parser import extract_text_from_pdf

router = APIRouter()


@router.post(
    "/",
    summary="Upload a PDF resume, extract text, and build a structured profile via AI",
    response_description="Structured profile extracted by Claude, persisted to the database",
)
async def extract_resume(
    file: UploadFile = File(..., description="Resume PDF file"),
    profile_name: str = Form(..., description="Label for this profile, e.g. 'Academic'"),
) -> dict:
    """
    Full extraction pipeline: PDF → raw text → AI profile → database.

    Args:
        file:         The uploaded resume — must be a PDF.
        profile_name: Human-readable label to store this profile under.

    Returns:
        dict containing:
            status       — "success"
            profile_name — echoed label
            profile      — full structured profile dict returned by Claude
            char_count   — total characters in the extracted raw text
            preview      — first 300 characters of the extracted raw text

    Raises:
        HTTP 400: File is not a PDF.
        HTTP 422: PDF contains no extractable text (e.g. scanned image).
        HTTP 502: Claude AI extraction failed.
        HTTP 500: Profile could not be persisted to the database.
    """
    print(f"[Fillosophy /extract] Received: {file.filename!r}, profile: {profile_name!r}")

    # Step 1: validate PDF
    is_pdf_mime     = (file.content_type or "").lower() == "application/pdf"
    is_pdf_filename = (file.filename or "").lower().endswith(".pdf")

    if not (is_pdf_mime or is_pdf_filename):
        print(
            f"[Fillosophy /extract] Rejected — not a PDF: "
            f"content_type={file.content_type!r}, filename={file.filename!r}"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files are accepted.",
        )

    # Step 2: read file bytes
    contents = await file.read()
    print(f"[Fillosophy /extract] Read {len(contents):,} bytes from '{file.filename}'")

    # Step 3: extract raw text from PDF
    try:
        raw_text = extract_text_from_pdf(contents)
    except ValueError as exc:
        print(f"[Fillosophy /extract] PDF extraction failed (no text): {exc}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    print(f"[Fillosophy /extract] PDF parsed: {len(raw_text)} chars")

    # Step 4: AI profile extraction via Claude
    try:
        profile_data = extract_profile_from_text(raw_text)
    except (RuntimeError, ValueError) as exc:
        print(f"[Fillosophy /extract] AI extraction failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI extraction failed: {exc}",
        )

    print(f"[Fillosophy /extract] AI extraction complete: {profile_name}")

    # Step 5: persist profile to the active database backend
    try:
        save_profile(profile_name, profile_data)
    except RuntimeError as exc:
        print(f"[Fillosophy /extract] DB save failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Profile could not be saved: {exc}",
        )

    print(f"[Fillosophy /extract] Profile saved to DB: {profile_name}")

    # Step 6: return structured result
    return {
        "status":       "success",
        "profile_name": profile_name,
        "profile":      profile_data,
        "char_count":   len(raw_text),
        "preview":      raw_text[:300],
    }
