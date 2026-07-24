import os
import requests
import json
import time

# Fillosophy — Final full-system regression test
# Usage: python tests/test_week6_final.py
# Run this before recording the demo or submitting the project.
# Requires: backend running on port 8000, ANTHROPIC_API_KEY set,
# sample_resume.pdf present in tests/

BASE_URL = "http://localhost:8000"
TEST_PDF = os.path.join(os.path.dirname(__file__), "sample_resume.pdf")

# Move to the project root so paths like 'README.md' resolve correctly
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
os.chdir(project_root)

passed = 0
total = 0

def check(name, condition):
    global passed, total
    total += 1
    if condition:
        print(f"✓ PASS: {name}")
        passed += 1
    else:
        print(f"✗ FAIL: {name}")

print("\n--- Starting Fillosophy Final Regression Test ---\n")

# ==========================================
# SECTION A — Backend Health
# ==========================================
print("SECTION A — Backend Health")

try:
    res = requests.get(f"{BASE_URL}/")
    check("Root endpoint responds", res.status_code in (200, 404)) # FastAPI might not have / defined, but should respond
except requests.exceptions.ConnectionError:
    check("Root endpoint responds (Is the backend running?)", False)
    print("FATAL: Backend is not running on localhost:8000. Aborting tests.")
    exit(1)

# Check database initialized
db_exists = os.path.exists("backend/fillosophy.db")
check("Database initialized", db_exists)

# API key loaded is verified by doing a quick mock extraction or relying on the real extraction in Section B
# We'll just put a placeholder boolean, which we update if Section B extract passes.
api_key_works = False

# ==========================================
# SECTION B — Core Pipeline (Weeks 2-3)
# ==========================================
print("\nSECTION B — Core Pipeline (Weeks 2-3)")

extract_profile = None

try:
    with open(TEST_PDF, "rb") as f:
        res = requests.post(
            f"{BASE_URL}/extract",
            files={"file": ("sample_resume.pdf", f, "application/pdf")},
            data={"profile_name": "test_regression"}
        )
    
    if res.status_code == 200:
        extract_profile = res.json().get("profile")
        api_key_works = True
    
    check("PDF extraction works", res.status_code == 200 and extract_profile is not None)
except FileNotFoundError:
    check(f"PDF extraction works (missing {TEST_PDF})", False)

check("API key loaded (verified via /extract success)", api_key_works)

# Check persistence
res_persist = requests.get(f"{BASE_URL}/profiles/test_regression")
check("Profile persists", res_persist.status_code == 200 and res_persist.json().get("profile") is not None)

# Check non-PDF rejected
res_txt = requests.post(
    f"{BASE_URL}/extract",
    files={"file": ("fake.txt", b"dummy text", "text/plain")},
    data={"profile_name": "test_fail"}
)
check("Non-PDF rejected", res_txt.status_code in (400, 422, 415))


# ==========================================
# SECTION C — Matching (Weeks 4-5)
# ==========================================
print("\nSECTION C — Matching (Weeks 4-5)")

if extract_profile:
    match_payload = {
        "profile": extract_profile,
        "fields": ["Full Name", "Email Address", "CGPA", "Skills"]
    }
    res_match = requests.post(f"{BASE_URL}/match", json=match_payload)
    match_data = res_match.json()
    
    check("Match endpoint works", res_match.status_code == 200 and "mapping" in match_data)
    
    mapping = match_data.get("mapping", {})
    has_confidence = all("confidence" in v for v in mapping.values())
    check("Confidence scores present", has_confidence and len(mapping) > 0)
    
    # Large form batching
    large_fields = [f"Field {i}" for i in range(1, 46)]
    res_large = requests.post(
        f"{BASE_URL}/match",
        json={"profile": extract_profile, "fields": large_fields}
    )
    large_mapping = res_large.json().get("mapping", {})
    check("Large form batching works", res_large.status_code == 200 and len(large_mapping) == 45)
else:
    print("Skipping Section C tests due to extraction failure.")
    check("Match endpoint works", False)
    check("Confidence scores present", False)
    check("Large form batching works", False)


# ==========================================
# SECTION D — Profile Management (Week 6)
# ==========================================
print("\nSECTION D — Profile Management (Week 6)")

import_payload = {
    "profile_name": "test_import",
    "profile_data": {
        "full_name": "Import Test User",
        "email": "import@test.com"
    }
}
res_import = requests.post(f"{BASE_URL}/profiles/import", json=import_payload)
check("Import endpoint works", res_import.status_code == 200)

res_list = requests.get(f"{BASE_URL}/profiles/list")
list_data = res_list.json()
check("List endpoint works", res_list.status_code == 200 and isinstance(list_data.get("profiles"), list))

res_get = requests.get(f"{BASE_URL}/profiles/test_import")
check("Get single profile works", res_get.status_code == 200 and res_get.json().get("profile_name") == "test_import")

res_del = requests.delete(f"{BASE_URL}/profiles/test_import")
check("Delete endpoint works", res_del.status_code == 200)

res_get_gone = requests.get(f"{BASE_URL}/profiles/test_import")
check("Deleted profile is gone", res_get_gone.status_code == 404)

# Cleanup the extract test profile
requests.delete(f"{BASE_URL}/profiles/test_regression")


# ==========================================
# SECTION E — File Structure Check
# ==========================================
print("\nSECTION E — File Structure Check")

check("README.md exists", os.path.exists("README.md"))
check("API docs exist", os.path.exists("docs/API.md"))
check("Architecture docs exist", os.path.exists("docs/ARCHITECTURE.md"))
check(".env.example exists", os.path.exists("backend/.env.example"))

try:
    gitignore_content = open(".gitignore").read()
    check(".env is gitignored", ".env" in gitignore_content)
except FileNotFoundError:
    check(".env is gitignored (missing .gitignore)", False)

check("requirements.txt exists", os.path.exists("backend/requirements.txt"))


# ==========================================
# Final summary
# ==========================================
print("\n=== Fillosophy FINAL Regression Test Summary ===")
print(f"Passed: {passed} / {total}")
if passed == total:
    print("✓ All systems verified. Ready for demo recording and submission.")
else:
    print(f"✗ {total - passed} test(s) failed. Fix before recording demo.")
    print("Do not proceed to demo recording until this reaches 100%.")
