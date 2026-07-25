# Fillosophy — Week 3 end-to-end test
# Usage: python tests/test_week3.py
# Requires: backend running on port 8000, sample_resume.pdf in tests/

"""
test_week3.py

Validates the full Week 3 pipeline:
  Test 1 — Backend health check
  Test 2 — Full AI extraction pipeline (PDF → Claude → structured profile)
  Test 3 — Profile persisted to the active database backend
  Test 4 — Field matching placeholder endpoint
  Test 5 — Non-PDF rejection (HTTP 400)
  Test 6 — DB backend selector value

Run from backend/ with the server already up:
    uvicorn main:app --reload --port 8000
    python tests/test_week3.py
"""

import io
import json
import os
import sys

import requests

# ── sys.path setup ────────────────────────────────────────────────────────────
# Allow direct imports from backend/ (database, utils, etc.)
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from dotenv import load_dotenv          # noqa: E402
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from database.profiles import get_profile  # noqa: E402

# ── Configuration ─────────────────────────────────────────────────────────────
BASE_URL = "http://localhost:8000"
PDF_PATH = "tests/sample_resume.pdf"

SEP  = "─" * 60
SEP2 = "═" * 60

# ── Outcome tracking ──────────────────────────────────────────────────────────
passed = 0
total  = 0


def check(label: str, condition: bool) -> None:
    """Record one assertion result and print a pass/fail line."""
    global passed, total
    total += 1
    if condition:
        passed += 1
        print(f"  ✓ PASS — {label}")
    else:
        print(f"  ✗ FAIL — {label}")


# ── Pre-flight ────────────────────────────────────────────────────────────────
print(SEP2)
print("Fillosophy — Week 3 End-to-End Test Suite")
print(SEP2)

if not os.path.isfile(PDF_PATH):
    print(f"\n  ERROR: '{PDF_PATH}' not found.")
    print(f"  Place a PDF resume named 'sample_resume.pdf' inside backend/tests/")
    print("  Exiting — nothing to test.\n")
    sys.exit(1)

file_size = os.path.getsize(PDF_PATH)
print(f"\n  PDF found: {PDF_PATH}  ({file_size:,} bytes)")
print(f"  DB backend: supabase\n")

# Will be populated by Test 2 and used by subsequent tests
profile: dict | None = None

# ════════════════════════════════════════════════════════════
# Test 1 — Backend health check
# ════════════════════════════════════════════════════════════
print(SEP)
print("Test 1 — Backend health check")
print(SEP)

try:
    resp = requests.get(f"{BASE_URL}/", timeout=5)
    check("Backend is running",          resp.status_code == 200)
    check("Status message correct",
          resp.json().get("status") == "Fillosophy backend is running")
except requests.exceptions.ConnectionError:
    print("\n  ERROR: Cannot reach http://localhost:8000/")
    print("  Start the backend:  uvicorn main:app --reload --port 8000")
    print("  Aborting — all remaining tests require a live server.\n")
    print(SEP2)
    print(f"Passed: {passed} / {total}")
    print("Cannot run tests — backend not reachable.")
    print(SEP2)
    sys.exit(1)

# ════════════════════════════════════════════════════════════
# Test 2 — Full AI extraction pipeline
# ════════════════════════════════════════════════════════════
print(f"\n{SEP}")
print("Test 2 — Full AI extraction pipeline")
print(f"  POST {BASE_URL}/extract  ·  profile_name=Academic")
print(SEP)

try:
    with open(PDF_PATH, "rb") as pdf_file:
        resp = requests.post(
            f"{BASE_URL}/extract",
            files={"file": (os.path.basename(PDF_PATH), pdf_file, "application/pdf")},
            data={"profile_name": "Academic"},
            timeout=60,          # AI call may take a few seconds
        )

    check("Response is 200", resp.status_code == 200)

    if resp.status_code == 200:
        data = resp.json()

        check('Response has "profile" key',   "profile" in data)
        check("full_name is not None",         data["profile"].get("full_name") is not None)
        check("email is not None",             data["profile"].get("email") is not None)
        check("skills is not None",            data["profile"].get("skills") is not None)
        check("char_count is positive",        data.get("char_count", 0) > 0)

        profile = data["profile"]

        print("\n  ── Extracted profile fields ──")
        for key, value in profile.items():
            # Pretty-print lists compactly
            display = json.dumps(value) if isinstance(value, (list, dict)) else str(value)
            if len(display) > 120:
                display = display[:117] + "..."
            print(f"  {key:<20} : {display}")
    else:
        # Print the error detail to aid debugging
        try:
            detail = resp.json().get("detail", resp.text)
        except Exception:
            detail = resp.text[:300]
        print(f"\n  Error detail: {detail}")

except requests.exceptions.Timeout:
    print("  ERROR: Request timed out after 60 s. Is the AI call completing?")
    check("Response is 200", False)
except requests.exceptions.ConnectionError as exc:
    print(f"  ERROR: Connection failed — {exc}")
    check("Response is 200", False)

# ════════════════════════════════════════════════════════════
# Test 3 — Profile persisted in DB
# ════════════════════════════════════════════════════════════
print(f"\n{SEP}")
print("Test 3 — Profile persisted in DB (direct import, no HTTP)")
print(SEP)

if profile is None:
    print("  SKIP — Test 2 did not produce a profile; cannot verify persistence.")
    total += 2
    print(f"  ✗ FAIL — Profile saved to DB (skipped)")
    print(f"  ✗ FAIL — Saved full_name matches extraction (skipped)")
else:
    try:
        saved = get_profile("Academic")
        check("Profile saved to DB",               saved is not None)
        check("Saved full_name matches extraction",
              saved is not None and
              saved.get("full_name") == profile.get("full_name"))
    except Exception as exc:
        print(f"  ERROR calling get_profile(): {exc}")
        check("Profile saved to DB",               False)
        check("Saved full_name matches extraction", False)

# ════════════════════════════════════════════════════════════
# Test 4 — Field matching placeholder
# ════════════════════════════════════════════════════════════
print(f"\n{SEP}")
print("Test 4 — Field matching placeholder")
print(f"  POST {BASE_URL}/match")
print(SEP)

field_labels = [
    "Full Name",
    "Email Address",
    "CGPA",
    "Degree Program",
    "Skills",
    "Phone Number",
]

match_payload = {
    "profile": profile if profile else {"full_name": "Test User", "email": "test@example.com"},
    "fields":  field_labels,
}

try:
    resp = requests.post(
        f"{BASE_URL}/match",
        json=match_payload,
        timeout=10,
    )

    check("Match response is 200",      resp.status_code == 200)

    if resp.status_code == 200:
        data = resp.json()
        check("status is 'success'",    data.get("status") == "success")
        check("total_fields is 6",      data.get("total_fields") == 6)
        check('"mapping" key present',  "mapping" in data)
        print(f"\n  high_confidence : {data.get('high_confidence')}")
        print(f"  needs_review    : {data.get('needs_review')}")
        print(f"  mapping keys    : {list(data.get('mapping', {}).keys())}")
    else:
        try:
            detail = resp.json().get("detail", resp.text)
        except Exception:
            detail = resp.text[:300]
        print(f"\n  Error detail: {detail}")

except requests.exceptions.ConnectionError as exc:
    print(f"  ERROR: Connection failed — {exc}")
    check("Match response is 200",  False)
    check("fields_received is 6",   False)

# ════════════════════════════════════════════════════════════
# Test 5 — Non-PDF rejection
# ════════════════════════════════════════════════════════════
print(f"\n{SEP}")
print("Test 5 — Non-PDF rejection")
print(f"  POST {BASE_URL}/extract  ·  .txt file  →  expect HTTP 400")
print(SEP)

try:
    fake_txt = io.BytesIO(b"This is a plain text file, not a PDF.")
    resp = requests.post(
        f"{BASE_URL}/extract",
        files={"file": ("resume.txt", fake_txt, "text/plain")},
        data={"profile_name": "test"},
        timeout=10,
    )
    check("Non-PDF returns 400", resp.status_code == 400)
    print(f"\n  Detail: {resp.json().get('detail', '(none)')}")

except requests.exceptions.ConnectionError as exc:
    print(f"  ERROR: Connection failed — {exc}")
    check("Non-PDF returns 400", False)

# ════════════════════════════════════════════════════════════
# Test 6 — Supabase configuration
# ════════════════════════════════════════════════════════════
print(f"\n{SEP}")
print("Test 6 — Supabase configuration")
print(SEP)

check('SUPABASE_URL is set',
      bool(os.getenv("SUPABASE_URL")))
check('SUPABASE_KEY is set',
      bool(os.getenv("SUPABASE_KEY")))
print(f"\n  Active backend: supabase")

# ════════════════════════════════════════════════════════════
# Final summary
# ════════════════════════════════════════════════════════════
print(f"\n{SEP2}")
print("=== Fillosophy Week 3 Test Summary ===")
print(f"Passed: {passed} / {total}")
if passed == total:
    print("All tests passed. Ready for Week 4.")
else:
    print(f"{total - passed} test(s) failed. Review output above.")
print(SEP2)

sys.exit(0 if passed == total else 1)
