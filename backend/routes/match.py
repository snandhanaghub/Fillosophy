"""
routes/match.py — Fillosophy FastAPI Backend

Maps detected form fields to the best-matching profile values using Claude AI.

POST /match
    Accepts an active profile (dict) and a list of field label strings
    collected from the current web page, then returns a confidence-scored
    fill value for every field.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from utils.ai_client import match_fields_to_profile

router = APIRouter()


# Request schema

class MatchRequest(BaseModel):
    """
    Payload sent by the popup with the active profile and the field labels
    collected from the current page by the content script.
    """
    profile: dict = Field(
        ...,
        description="Structured profile dict as returned by the /extract endpoint.",
        example={
            "full_name":       "Aditya Jain",
            "email":           "aditya@example.com",
            "phone":           "+91-9999999999",
            "degree":          "B.Tech Computer Science",
            "cgpa":            9.2,
            "skills":          ["Python", "FastAPI", "React"],
        },
    )
    fields: list[str] = Field(
        ...,
        description=(
            "Best-available label strings for each detected form field, "
            "collected by collectFieldLabels() in popup.js."
        ),
        example=["Full Name", "Email Address", "CGPA", "Degree Program",
                 "Skills", "Phone Number"],
    )
    profile_name: str | None = Field(
        default=None,
        description="Name of the active profile — used for logging only.",
    )


# Route

@router.post(
    "/",
    summary="Match form fields to profile values",
    response_description="Confidence-scored fill values keyed by field label",
)
async def match_fields(payload: MatchRequest) -> dict:
    """
    Receives the active profile and a list of form field labels, calls
    Claude AI to semantically match each label to a profile value, and
    returns a confidence-scored mapping.

    Args:
        payload: MatchRequest containing the profile dict, field label list,
                 and an optional profile name for logging.

    Returns:
        dict with keys:
          - status:          "success"
          - total_fields:    number of labels submitted
          - high_confidence: count of entries with confidence >= 80
          - needs_review:    count of entries with confidence < 70
          - mapping:         full Claude response (field → {value, confidence})

    Raises:
        HTTP 400 if fields list or profile is empty.
        HTTP 502 if the AI matching call fails.
    """

    # Validation
    if len(payload.fields) == 0:
        raise HTTPException(status_code=400, detail="No field labels provided")

    if not payload.profile:
        raise HTTPException(status_code=400, detail="Profile is empty")

    # AI matching
    profile_tag = f'"{payload.profile_name}"' if payload.profile_name else "(unnamed)"
    print(f"[Fillosophy /match] Matching {len(payload.fields)} fields "
          f"against profile {profile_tag}")

    try:
        if len(payload.fields) > 40:
            # Large form — batch to avoid hitting Claude's context/output limits
            batch_size = 30
            n = len(payload.fields)
            print(f"[Fillosophy /match] Large form detected, batching {n} fields")
            mapping = {}
            for i in range(0, n, batch_size):
                batch = payload.fields[i:i + batch_size]
                print(f"[Fillosophy /match] Batch {i // batch_size + 1}: "
                      f"fields {i + 1}–{min(i + batch_size, n)}")
                batch_result = match_fields_to_profile(payload.profile, batch)
                mapping.update(batch_result)
        else:
            mapping = match_fields_to_profile(payload.profile, payload.fields)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"AI matching failed: {exc}",
        ) from exc

    # Confidence summary
    total = len(payload.fields)
    high  = sum(
        1 for entry in mapping.values()
        if isinstance(entry, dict) and entry.get("confidence", 0) >= 80
    )
    low   = sum(
        1 for entry in mapping.values()
        if isinstance(entry, dict) and entry.get("confidence", 100) < 70
    )

    print(f"[Fillosophy /match] High: {high} | Review: {low}")

    return {
        "status":          "success",
        "total_fields":    total,
        "high_confidence": high,
        "needs_review":    low,
        "mapping":         mapping,
    }
