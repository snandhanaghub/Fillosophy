# Fillosophy — FastAPI Backend Entry Point
"""
main.py

Entry point for the Fillosophy API server.
Configures the FastAPI app, CORS middleware, startup hooks, and routers.

Run locally:
    uvicorn main:app --reload --port 8000

Interactive docs:
    http://localhost:8000/docs   (Swagger UI)
    http://localhost:8000/redoc  (ReDoc)
"""

import os

from dotenv import load_dotenv
load_dotenv(override=True)  # Must run before any import that reads os.getenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.extract import router as extract_router
from routes.match import router as match_router
from routes.profiles import router as profiles_router
from routes.auth import router as auth_router
from database.profiles import init_db

# ─── App instance ─────────────────────────────────────────────
app = FastAPI(
    title="Fillosophy API",
    description=(
        "Backend for Fillosophy — an AI-powered Chrome Extension that reads "
        "your resume and autofills web forms intelligently."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─── CORS middleware ───────────────────────────────────────────
# Chrome extensions send requests from chrome-extension:// origins.
# allow_origins=["*"] is required for local development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Startup ───────────────────────────────────────────────────
@app.on_event("startup")
def startup():
    """Initialise the database and validate required environment variables."""
    init_db()

    # ── Validate Claude API key ────────────────────────────────────────────────────────
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        print("[Fillosophy] WARNING: ANTHROPIC_API_KEY is not set.")
        print("[Fillosophy] Claude API calls will fail until this is set.")
    else:
        masked = api_key[:8] + "..." + api_key[-4:]
        print(f"[Fillosophy] Claude API key loaded: {masked}")

    # ── Validate Supabase credentials ───────────────────────────────────────────────
    sb_url = os.getenv("SUPABASE_URL")
    sb_key = os.getenv("SUPABASE_KEY")
    if not sb_url or not sb_key:
        print("[Fillosophy] WARNING: SUPABASE_URL or SUPABASE_KEY is not set.")
        print("[Fillosophy] Profile storage will fail until both are configured.")
    else:
        print(f"[Fillosophy] Supabase configured: {sb_url}")

# ─── Routers ──────────────────────────────────────────────────
app.include_router(extract_router,  prefix="/extract",  tags=["Extract"])
app.include_router(match_router,    prefix="/match",    tags=["Match"])
app.include_router(profiles_router, prefix="/profiles", tags=["Profiles"])
app.include_router(auth_router,     prefix="/auth",     tags=["Auth"])
print("[Fillosophy] Auth routes registered at /auth")
print("[Fillosophy] Profile management routes registered at /profiles")


# ─── Root / health-check ──────────────────────────────────────
@app.get("/", tags=["Health"], summary="Health check")
async def root() -> dict:
    """
    Returns a simple status message confirming the backend is reachable.
    Used by the Chrome extension on startup to verify connectivity.
    """
    return {"status": "Fillosophy backend is running"}
