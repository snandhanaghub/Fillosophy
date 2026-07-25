# Fillosophy — Profile management routes
"""
routes/profiles.py

CRUD + import endpoints for stored profiles.
Called by the Chrome extension's import flow and available via Swagger UI.

Routes (mounted at /profiles by main.py):
    POST   /profiles/import     — Import a profile from JSON
    GET    /profiles/list       — List all saved profile names
    GET    /profiles/{name}     — Retrieve a single profile by name
    DELETE /profiles/{name}     — Delete a profile by name
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from database.profiles import save_profile, get_profile, list_profiles, delete_profile
from routes.auth import get_current_user_id

router = APIRouter()


# ─── Request schemas ──────────────────────────────────────────

class ImportRequest(BaseModel):
    profile_name: str
    profile_data: dict


# ─── Endpoints ────────────────────────────────────────────────

@router.post("/import")
def import_profile(body: ImportRequest, user_id: str = Depends(get_current_user_id)):
    """
    Import a profile exported from the Chrome extension.
    Overwrites any existing profile with the same name.
    """
    try:
        save_profile(body.profile_name, body.profile_data, user_id)
        return {
            "status": "success",
            "profile_name": body.profile_name,
            "message": "Profile imported and saved",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")


@router.get("/list")
def list_all_profiles(user_id: str = Depends(get_current_user_id)):
    """Return the names of every stored profile."""
    try:
        names = list_profiles(user_id)
        return {"status": "success", "profiles": names, "count": len(names)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}")
def get_single_profile(name: str, user_id: str = Depends(get_current_user_id)):
    """Retrieve a single profile by name. Returns 404 if not found."""
    profile = get_profile(name, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail=f"Profile '{name}' not found")
    return {"status": "success", "profile_name": name, "profile": profile}


@router.delete("/{name}")
def delete_single_profile(name: str, user_id: str = Depends(get_current_user_id)):
    """Permanently remove a profile by name."""
    try:
        delete_profile(name, user_id)
        return {"status": "success", "message": f"Profile '{name}' deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
