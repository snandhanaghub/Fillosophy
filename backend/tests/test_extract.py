# Fillosophy — End-to-end test for PDF upload and parsing
"""
test_extract.py

Plain runnable script (no pytest) that validates two things:

  BLOCK A — Unit test: pdf_parser.py directly
      Reads a local PDF from disk and calls extract_text_from_pdf()
      without going through the network or FastAPI.
      Verifies the parser produces non-empty output.

  BLOCK B — Integration test: POST /extract endpoint
      Sends the same PDF to the running FastAPI server via HTTP.
      Verifies the endpoint returns 200 with the expected JSON fields.

Usage:
  1. Place "sample_resume.pdf" in the backend/ directory.
  2. Start the backend:  uvicorn main:app --reload --port 8000
  3. Run this script:    python3 test_extract.py

Exit codes:
  0 — all checks passed
  1 — one or more checks failed
"""

import os
import sys

import requests

# Add the backend directory to sys.path so we can import local modules directly
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils.pdf_parser import extract_text_from_pdf  # noqa: E402

# ─── Configuration ────────────────────────────────────────────
PDF_PATH    = "sample_resume.pdf"   # Place this file in backend/
EXTRACT_URL = "http://localhost:8000/extract"
PROFILE     = "Academic"

SEPARATOR   = "─" * 60

# ─── Outcome tracking ─────────────────────────────────────────
failures: list[str] = []

def pass_(label: str) -> None:
    print(f"  ✓ PASS  {label}")

def fail_(label: str, detail: str = "") -> None:
    msg = f"  ✗ FAIL  {label}" + (f" — {detail}" if detail else "")
    print(msg)
    failures.append(msg)

# ══════════════════════════════════════════════════════════════
# PRE-FLIGHT: confirm the sample PDF exists on disk
# ══════════════════════════════════════════════════════════════

print(SEPARATOR)
print("PRE-FLIGHT: checking for sample_resume.pdf")
print(SEPARATOR)

if not os.path.isfile(PDF_PATH):
    print(f"\n  ERROR: '{PDF_PATH}' not found in {os.getcwd()}/")
    print("  Place a PDF resume named 'sample_resume.pdf' in the backend/ directory.")
    print("  Exiting — nothing to test.\n")
    sys.exit(1)

file_size = os.path.getsize(PDF_PATH)
print(f"  Found: {PDF_PATH}  ({file_size:,} bytes)\n")

# ══════════════════════════════════════════════════════════════
# BLOCK A — Direct unit test of pdf_parser.extract_text_from_pdf()
# ══════════════════════════════════════════════════════════════

print(SEPARATOR)
print("BLOCK A — Unit test: pdf_parser.extract_text_from_pdf()")
print(SEPARATOR)

# Read the PDF from disk as raw bytes
print(f"\n  Reading '{PDF_PATH}' from disk …")
with open(PDF_PATH, "rb") as f:
    pdf_bytes = f.read()

print(f"  Read {len(pdf_bytes):,} bytes.\n")

# Call the parser directly — no HTTP, no FastAPI
print("  Calling extract_text_from_pdf(pdf_bytes) …\n")
try:
    extracted_text = extract_text_from_pdf(pdf_bytes)

    # Check 1: returned value must be a non-empty string
    if isinstance(extracted_text, str) and len(extracted_text) > 0:
        pass_("extract_text_from_pdf() returned a non-empty string")
    else:
        fail_("extract_text_from_pdf() returned empty or wrong type",
              repr(extracted_text[:50]))

    # Check 2: output should not be more than one consecutive blank line
    if "\n\n\n" not in extracted_text:
        pass_("no triple consecutive newlines in output")
    else:
        fail_("output contains 3+ consecutive newlines (blank-line collapse failed)")

    # Print the first 500 characters as a human-readable preview
    print(f"\n  ── Extracted text preview (first 500 chars) ──")
    print(f"  char_count = {len(extracted_text):,}")
    print()
    for line in extracted_text[:500].splitlines():
        print(f"  {line}")
    if len(extracted_text) > 500:
        print(f"  … ({len(extracted_text) - 500:,} more chars)")

except ValueError as exc:
    fail_("extract_text_from_pdf() raised ValueError (no text found)", str(exc))
    print("       → The PDF may be a scanned image with no embedded text.")

except Exception as exc:
    fail_("extract_text_from_pdf() raised unexpected exception", str(exc))

# ══════════════════════════════════════════════════════════════
# BLOCK B — Integration test: POST http://localhost:8000/extract
# ══════════════════════════════════════════════════════════════

print(f"\n{SEPARATOR}")
print("BLOCK B — Integration test: POST /extract endpoint")
print(SEPARATOR)

print(f"\n  Target URL : {EXTRACT_URL}")
print(f"  profile_name: {PROFILE}")
print(f"  file        : {PDF_PATH}\n")

# Check the server is reachable before attempting upload
try:
    health = requests.get("http://localhost:8000/", timeout=3)
    if health.status_code == 200:
        pass_(f"Backend health check — {health.json()}")
    else:
        fail_("Backend health check returned non-200", str(health.status_code))
except requests.exceptions.ConnectionError:
    print("  ERROR: Cannot reach http://localhost:8000/")
    print("         Start the backend with:  uvicorn main:app --reload --port 8000")
    print("         Skipping integration tests.\n")
    # Don't exit — still report Block A results
    failures.append("BLOCK B skipped — backend not running")
    health = None

if health and health.status_code == 200:
    # Send the PDF as multipart/form-data
    print(f"\n  Posting '{PDF_PATH}' to {EXTRACT_URL} …\n")
    with open(PDF_PATH, "rb") as pdf_file:
        response = requests.post(
            EXTRACT_URL,
            files={"file": (os.path.basename(PDF_PATH), pdf_file, "application/pdf")},
            data={"profile_name": PROFILE},
            timeout=30,
        )

    # Check 1: HTTP status
    print(f"  Response status : {response.status_code}")
    if response.status_code == 200:
        pass_("HTTP 200 received")
    else:
        fail_(f"Expected HTTP 200, got {response.status_code}")
        try:
            error_detail = response.json().get("detail", response.text)
            print(f"  Error detail: {error_detail}")
        except Exception:
            print(f"  Raw response: {response.text[:300]}")

    # Check 2: JSON fields present and correct
    if response.status_code == 200:
        body = response.json()
        print(f"\n  ── Response JSON ──")

        # status field
        if body.get("status") == "parsed":
            pass_('response["status"] == "parsed"')
        else:
            fail_('response["status"] != "parsed"', repr(body.get("status")))

        # profile_name echoed back
        if body.get("profile_name") == PROFILE:
            pass_(f'response["profile_name"] == "{PROFILE}"')
        else:
            fail_("profile_name mismatch", repr(body.get("profile_name")))

        # char_count is a positive integer
        char_count = body.get("char_count", 0)
        if isinstance(char_count, int) and char_count > 0:
            pass_(f"char_count = {char_count:,} (positive integer)")
        else:
            fail_("char_count missing or zero", repr(char_count))

        # preview is a non-empty string
        preview = body.get("preview", "")
        if isinstance(preview, str) and len(preview) > 0:
            pass_(f"preview present ({len(preview)} chars)")
        else:
            fail_("preview missing or empty")

        # raw_text is present
        if isinstance(body.get("raw_text"), str) and len(body["raw_text"]) > 0:
            pass_("raw_text present and non-empty")
        else:
            fail_("raw_text missing or empty")

        # Print the preview for human review
        print(f"\n  ── Preview (first 300 chars from server) ──")
        print(f"  char_count = {char_count:,}")
        print()
        for line in preview.splitlines():
            print(f"  {line}")

# ══════════════════════════════════════════════════════════════
# FINAL REPORT
# ══════════════════════════════════════════════════════════════

print(f"\n{SEPARATOR}")
if not failures:
    print("ALL CHECKS PASSED ✓")
    print(SEPARATOR)
    sys.exit(0)
else:
    print(f"FAILED — {len(failures)} check(s) did not pass:")
    for f in failures:
        print(f)
    print(SEPARATOR)
    sys.exit(1)
