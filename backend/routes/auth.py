# Fillosophy — Authentication routes using Supabase Auth
"""
routes/auth.py

Handles user sign-up, log-in, session verification, and log-out via Supabase Auth.
Called by the Chrome extension popup auth screens.
"""

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional
from database.supabase_db import get_client

router = APIRouter()


# ─── Request Schemas ──────────────────────────────────────────

class SignUpRequest(BaseModel):
    name: str
    email: str
    password: str


class LogInRequest(BaseModel):
    email: str
    password: str


# ─── Helper Functions ─────────────────────────────────────────

def _format_user_response(res):
    """Extract clean user and session dictionaries from Supabase AuthResponse."""
    user = res.user
    session = res.session

    if not user:
        raise HTTPException(status_code=400, detail="Authentication failed: No user returned.")

    user_data = {
        "id": user.id,
        "email": user.email,
        "name": user.user_metadata.get("full_name") if user.user_metadata else None,
    }

    session_data = None
    if session:
        session_data = {
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
            "expires_in": session.expires_in,
        }

    return {
        "status": "success",
        "user": user_data,
        "session": session_data,
    }


# ─── Endpoints ────────────────────────────────────────────────

@router.post("/signup", summary="Create a new account via Supabase Auth")
def signup(body: SignUpRequest):
    """
    Register a new user with name, email, and password.
    Returns user details and auth session tokens.
    """
    try:
        client = get_client()
        res = client.auth.sign_up({
            "email": body.email,
            "password": body.password,
            "options": {
                "data": {
                    "full_name": body.name
                }
            }
        })
        return _format_user_response(res)
    except Exception as e:
        err_msg = str(e)
        if "User already registered" in err_msg or "already exists" in err_msg:
            raise HTTPException(status_code=400, detail="An account with this email already exists.")
        raise HTTPException(status_code=400, detail=f"Sign up failed: {err_msg}")


@router.post("/login", summary="Log in with email and password")
def login(body: LogInRequest):
    """
    Authenticate an existing user with email and password.
    Returns user details and auth session tokens.
    """
    try:
        client = get_client()
        res = client.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password,
        })
        return _format_user_response(res)
    except Exception as e:
        err_msg = str(e)
        if "Invalid login credentials" in err_msg or "invalid_grant" in err_msg:
            raise HTTPException(status_code=401, detail="Invalid email or password.")
        raise HTTPException(status_code=400, detail=f"Log in failed: {err_msg}")


@router.get("/verify", summary="Verify access token and return user profile")
def verify_session(authorization: Optional[str] = Header(None)):
    """
    Verify an existing JWT access token sent in the Authorization header (Bearer <token>).
    Used by the extension on startup to check if the session is still valid.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")

    token = authorization.split(" ")[1]
    try:
        client = get_client()
        # Retrieve user using the JWT
        res = client.auth.get_user(token)
        user = res.user
        if not user:
            raise HTTPException(status_code=401, detail="Invalid or expired session token.")

        return {
            "status": "success",
            "user": {
                "id": user.id,
                "email": user.email,
                "name": user.user_metadata.get("full_name") if user.user_metadata else None,
            }
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail="Session verification failed. Please log in again.")


@router.post("/logout", summary="Log out the user")
def logout():
    """
    Sign out the current session.
    """
    try:
        client = get_client()
        client.auth.sign_out()
        return {"status": "success", "message": "Logged out successfully"}
    except Exception as e:
        return {"status": "success", "message": "Logged out"}
