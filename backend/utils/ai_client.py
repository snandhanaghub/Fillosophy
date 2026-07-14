"""
Fillosophy — Claude API client wrapper.
Handles resume extraction and semantic field matching via the Anthropic SDK.

Mock mode & automatic fallback
-------------------------------
MOCK_AI=true  (in .env)  → always use mock, no API key needed, free & offline.
MOCK_AI=false (default)  → try the real Claude API first.

Automatic fallback: if a real API call fails for ANY reason
(credits exhausted, bad key, rate-limited, Anthropic outage, no internet)
the module automatically falls back to mock responses for the rest of the
session so the project keeps running. A clear warning is printed each time.
"""

import json
import logging
import os
import re
import time
import httpx

# Logging

logger = logging.getLogger(__name__)
LOG_PREFIX = "[Fillosophy AI]"

# Mock mode
# MOCK_AI=true  → free, instant, offline — no API key required
# MOCK_AI=false → real API call (default)

MOCK_AI: bool = os.getenv("MOCK_AI", "false").strip().lower() == "true"

# Tracks the active AI provider.
# Defaults to "anthropic", but will cascade down to "groq" -> "openrouter" -> "mock" on failure.
_active_provider: str = os.getenv("DEFAULT_PROVIDER", "anthropic")

if MOCK_AI:
    logger.warning("%s MOCK_AI=true — AI API calls are disabled.", LOG_PREFIX)
    print(f"{LOG_PREFIX} MOCK_AI=true — all AI responses are fake (free & offline).")

def _call_openai_compatible(endpoint: str, api_key: str, model: str, system_prompt: str, user_message: str) -> str:
    """Helper to call Groq or OpenRouter via their OpenAI-compatible endpoints."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ]
    }
    # Groq prefers explicit json_object response format
    if "groq" in endpoint:
        payload["response_format"] = {"type": "json_object"}

    with httpx.Client() as client:
        resp = client.post(endpoint, headers=headers, json=payload, timeout=60.0)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

def _get_completion(system_prompt: str, user_message: str, context: str) -> str:
    """
    Cascades through Anthropic → Groq → OpenRouter.
    If a provider fails, logs a warning, switches the active provider, and tries the next.
    If all fail (or MOCK_AI=true), raises an exception to trigger the mock fallback.
    """
    global _active_provider
    
    if MOCK_AI or _active_provider == "mock":
        raise RuntimeError("Mock mode active")

    providers = ["anthropic", "groq", "openrouter"]
    start_idx = providers.index(_active_provider) if _active_provider in providers else 0

    last_exc = None
    for provider in providers[start_idx:]:
        try:
            if provider == "anthropic":
                api_key = os.getenv("ANTHROPIC_API_KEY")
                if not api_key:
                    raise ValueError("ANTHROPIC_API_KEY not set")
                logger.info("%s Calling Anthropic API for %s", LOG_PREFIX, context)
                # Retry up to 2 times with exponential backoff for rate-limit / timeout
                max_retries = 2
                for attempt in range(max_retries + 1):
                    try:
                        resp = _get_client().messages.create(
                            model=_MODEL,
                            max_tokens=_MAX_TOKENS,
                            system=system_prompt,
                            messages=[{"role": "user", "content": user_message}],
                        )
                        if _active_provider != provider:
                            _active_provider = provider
                        return resp.content[0].text
                    except Exception as retry_exc:
                        err_name = type(retry_exc).__name__
                        is_retryable = any(kw in err_name.lower() for kw in (
                            'ratelimit', 'rate_limit', 'timeout', 'overloaded',
                        )) or any(kw in str(retry_exc).lower() for kw in (
                            'rate limit', 'timeout', '529', 'overloaded',
                        ))
                        if is_retryable and attempt < max_retries:
                            wait = 2 ** attempt  # 1s, then 2s
                            logger.warning(
                                "%s Retryable error on attempt %d/%d (%s), "
                                "retrying in %ds…",
                                LOG_PREFIX, attempt + 1, max_retries + 1,
                                err_name, wait,
                            )
                            print(
                                f"{LOG_PREFIX} ⏳ {err_name} — retrying in {wait}s "
                                f"(attempt {attempt + 1}/{max_retries + 1})"
                            )
                            time.sleep(wait)
                        else:
                            if attempt == max_retries and is_retryable:
                                raise RuntimeError(
                                    "Claude API is currently unavailable. "
                                    "Please try again in a moment."
                                ) from retry_exc
                            raise  # Non-retryable error — let cascade handle it

            elif provider == "groq":
                api_key = os.getenv("GROQ_API_KEY")
                if not api_key:
                    raise ValueError("GROQ_API_KEY not set")
                logger.info("%s Calling Groq API for %s", LOG_PREFIX, context)
                content = _call_openai_compatible(
                    "https://api.groq.com/openai/v1/chat/completions",
                    api_key,
                    "llama-3.3-70b-versatile",
                    system_prompt,
                    user_message
                )
                if _active_provider != provider:
                    _active_provider = provider
                return content

            elif provider == "openrouter":
                api_key = os.getenv("OPENROUTER_API_KEY")
                if not api_key:
                    raise ValueError("OPENROUTER_API_KEY not set")
                logger.info("%s Calling OpenRouter API for %s", LOG_PREFIX, context)
                content = _call_openai_compatible(
                    "https://openrouter.ai/api/v1/chat/completions",
                    api_key,
                    "poolside/laguna-xs-2.1:free",
                    system_prompt,
                    user_message
                )
                if _active_provider != provider:
                    _active_provider = provider
                return content

        except Exception as exc:
            last_exc = exc
            next_provider = providers[providers.index(provider) + 1] if provider != providers[-1] else "mock"
            print(
                f"\n{LOG_PREFIX} ⚠️  API FALLBACK TRIGGERED ({context})\n"
                f"{LOG_PREFIX}    Provider : {provider} failed -> Switching to {next_provider}\n"
                f"{LOG_PREFIX}    Reason   : {type(exc).__name__}: {exc}\n"
            )
            logger.warning("%s Fallback triggered (%s) from %s to %s: %s", LOG_PREFIX, context, provider, next_provider, exc)
            if next_provider != "mock":
                _active_provider = next_provider
            else:
                # If we hit mock, don't permanently lock the server to mock mode.
                # Reset to anthropic so the next request tries the real APIs again.
                _active_provider = "anthropic"

    # If we get here, all providers failed
    raise RuntimeError(f"All AI providers failed. Last error: {last_exc}")

# Client setup
# The Anthropic client is only created when mock mode is OFF.
# This means no ANTHROPIC_API_KEY is required when MOCK_AI=true.

def _get_client():
    """Lazy-initialise the Anthropic client (once) on first real API call."""
    if not hasattr(_get_client, "_instance"):
        from anthropic import Anthropic
        _get_client._instance = Anthropic()
    return _get_client._instance

_MODEL      = "claude-sonnet-4-6"
_MAX_TOKENS = 1000

# Mock responses

_MOCK_PROFILE: dict = {
    "full_name":       "Alex Carter (Mock)",
    "email":           "alex.carter@example.com",
    "phone":           "+1-555-019-8472",
    "address":         "San Francisco, CA, USA",
    "degree":          "B.Tech Computer Science",
    "institution":     "Mock University of Technology",
    "cgpa":            9.2,
    "graduation_year": 2026,
    "skills":          ["Python", "FastAPI", "React", "SQL", "Docker"],
    "experience": [
        {
            "role":        "Software Engineering Intern",
            "company":     "Mock Corp",
            "duration":    "May 2024 – July 2024",
            "description": "Built mock features for mock systems.",
        }
    ],
    "projects": [
        {
            "name":         "Fillosophy",
            "description":  "AI-powered Chrome extension that autofills forms.",
            "technologies": "Python, FastAPI, Claude AI, JavaScript",
        }
    ],
    "certifications": ["Mock AWS Certified Developer"],
}


def _mock_match(field_labels: list[str]) -> dict:
    """Return a plausible fake match result for every field label."""
    mapping = {
        "full name":          (_MOCK_PROFILE["full_name"],       98),
        "name":               (_MOCK_PROFILE["full_name"],       97),
        "email":              (_MOCK_PROFILE["email"],           97),
        "email address":      (_MOCK_PROFILE["email"],           97),
        "phone":              (_MOCK_PROFILE["phone"],           95),
        "phone number":       (_MOCK_PROFILE["phone"],           95),
        "contact":            (_MOCK_PROFILE["phone"],           90),
        "mobile":             (_MOCK_PROFILE["phone"],           90),
        "cgpa":               (_MOCK_PROFILE["cgpa"],            95),
        "gpa":                (_MOCK_PROFILE["cgpa"],            90),
        "academic score":     (_MOCK_PROFILE["cgpa"],            88),
        "percentage":         (_MOCK_PROFILE["cgpa"],            65),
        "degree":             (_MOCK_PROFILE["degree"],          93),
        "degree program":     (_MOCK_PROFILE["degree"],          93),
        "branch":             (_MOCK_PROFILE["degree"],          88),
        "department":         (_MOCK_PROFILE["degree"],          85),
        "program":            (_MOCK_PROFILE["degree"],          82),
        "course":             (_MOCK_PROFILE["degree"],          80),
        "institution":        (_MOCK_PROFILE["institution"],     93),
        "college":            (_MOCK_PROFILE["institution"],     92),
        "university":         (_MOCK_PROFILE["institution"],     92),
        "skills":             (", ".join(_MOCK_PROFILE["skills"]), 90),
        "graduation year":    (_MOCK_PROFILE["graduation_year"], 95),
        "passing year":       (_MOCK_PROFILE["graduation_year"], 92),
        "year of graduation": (_MOCK_PROFILE["graduation_year"], 92),
        "address":            (_MOCK_PROFILE["address"],         88),
    }
    result = {}
    for label in field_labels:
        value, confidence = mapping.get(label.lower(), (None, 0))
        entry: dict = {"value": value, "confidence": confidence}
        if confidence < 70:
            entry["low_confidence"] = True
        result[label] = entry
    return result


# Helpers

def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences (```json … ``` or ``` … ```) from a string."""
    text = re.sub(r'^```(?:json)?\n?', '', text.strip())
    text = re.sub(r'\n?```$', '', text)
    return text


# Public API

_EXTRACTION_SYSTEM_PROMPT = """\
You are a resume parser. Your only job is to extract structured data
from resume text and return it as a valid JSON object.

Rules:
- Return ONLY a valid JSON object. No explanation, no markdown,
  no code fences, no preamble.
- If a field is not found in the resume, return null for that key.
- Never invent or guess values not present in the text.
- For skills, return a flat list of strings.
- For experience and projects, return a list of objects.
- CGPA: extract the numeric value only (e.g. 8.5, not "8.5/10").
- graduation_year: extract as a 4-digit integer (e.g. 2026).
"""


def extract_profile_from_text(raw_text: str) -> dict:
    """
    Send resume text to Claude and return a structured JSON profile.

    The response is validated to be a dict that contains at least the
    key ``"full_name"`` before being returned.

    Args:
        raw_text: Plain text extracted from the user's resume.

    Returns:
        A Python dict representing the parsed profile with keys:
        full_name, email, phone, address, degree, institution, cgpa,
        graduation_year, skills, experience, projects, certifications.

    Raises:
        RuntimeError: If the Anthropic API call fails.
        ValueError:   If Claude's response is not valid JSON or does not
                      match the expected schema.
    """
    user_message = f"""
Extract all available information from the following resume text and
return a JSON object with exactly these keys:

{{
  "full_name": string or null,
  "preferred_name": string or null (e.g., from 'Commonly known as', 'Nickname', etc.),
  "email": string or null,
  "phone": string or null,
  "address": string or null,
  "degree": string or null,
  "institution": string or null,
  "cgpa": number or null,
  "graduation_year": integer or null,
  "links": [ list of URLs or portfolio links ] or [],
  "skills": [ list of strings ] or [],
  "experience": [
    {{
      "role": string,
      "company": string,
      "duration": string,
      "description": string
    }}
  ] or [],
  "projects": [
    {{
      "name": string,
      "description": string,
      "technologies": string
    }}
  ] or [],
  "certifications": [ list of strings ] or [],
  "additional_info": string or null (any other relevant information like availability, motivation, or preferences)
}}

Resume text:
{raw_text}
"""

    try:
        raw_response = _get_completion(_EXTRACTION_SYSTEM_PROMPT, user_message, "profile extraction")
    except Exception:
        print(f"{LOG_PREFIX} MOCK — extract_profile_from_text (fallback triggered).")
        return dict(_MOCK_PROFILE)

    logger.info("%s Received profile extraction response.", LOG_PREFIX)

    raw = _strip_code_fences(raw_response)

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"{LOG_PREFIX} Claude returned malformed or non-JSON content during "
            f"profile extraction. Raw response:\n{raw}"
        ) from exc

    if not isinstance(parsed, dict) or "full_name" not in parsed:
        raise ValueError("Claude returned an unexpected format")

    return parsed


_MATCHING_SYSTEM_PROMPT = """\
You are a form autofill assistant. You receive a user's profile extracted
from their resume, and a list of form field labels from a web page.

Your job is to match each field label to the best value from the profile.

Rules:
- Return ONLY a valid JSON object. No explanation, no markdown, no preamble.
- Every field label in the input list must appear as a key in the output.
- confidence is an integer 0–100 representing match certainty.
- If confidence is below 70, include "low_confidence": true in that object.
- If no reasonable match exists, set value to null and confidence to 0.
- Semantic equivalence examples:
    "Academic Score", "GPA", "CGPA", "Percentage" → profile.cgpa
    "Full Name", "Applicant Name", "Your Name"     → profile.full_name
    "Preferred Name", "Nickname", "Known As"       → profile.preferred_name
    "Contact", "Mobile", "Phone Number"            → profile.phone
    "Branch", "Department", "Program", "Course"    → profile.degree
    "College", "University", "Institution"         → profile.institution
    "Passing Year", "Year of Graduation"           → profile.graduation_year
- For checkboxes requiring confirmation or consent (e.g. "I confirm...", "I agree..."), return true or "yes" with high confidence.
- If a field is clearly asking for a date (e.g. "Available From", "Start Date"), return the value strictly in YYYY-MM-DD format.
"""


def match_fields_to_profile(profile: dict, field_labels: list[str]) -> dict:
    """
    Send a profile and form field labels to Claude and return a mapping of
    each label to a suggested fill value with a confidence score.

    Skills are pre-processed from a list into a comma-separated string so
    Claude can write them directly into a plain text field.

    Args:
        profile:      Parsed profile dict (from extract_profile_from_text).
        field_labels: List of form field label strings detected on the page.

    Returns:
        A dict mapping every field label to an object with:
          - ``"value"``          : matched value (str, number, or null)
          - ``"confidence"``     : integer 0–100
          - ``"low_confidence"`` : true (only present when confidence < 70)

    Raises:
        RuntimeError: If the Anthropic API call fails.
        ValueError:   If Claude's response cannot be parsed as JSON or is
                      not a dict.
    """
    # Pre-process: flatten skills list → comma-separated string
    if isinstance(profile.get("skills"), list):
        profile["skills"] = ", ".join(profile["skills"])

    user_message = f"""
Profile:
{json.dumps(profile, indent=2)}

Form field labels:
{json.dumps(field_labels, indent=2)}

Return a JSON object where each key is a field label from the list,
and each value is an object with:
  "value": matched value from the profile (string, number, or null),
  "confidence": integer 0–100,
  "low_confidence": true (only include this key if confidence < 70)

Example:
{{
  "Full Name":  {{ "value": "Aditya J", "confidence": 98 }},
  "CGPA":       {{ "value": 8.5, "confidence": 95 }},
  "Skills":     {{ "value": "Python, React, SQL", "confidence": 69,
                   "low_confidence": true }}
}}
"""

    try:
        raw_response = _get_completion(_MATCHING_SYSTEM_PROMPT, user_message, "field matching")
    except Exception:
        print(f"{LOG_PREFIX} MOCK — match_fields_to_profile (fallback triggered).")
        return _mock_match(field_labels)

    logger.info("%s Received field matching response.", LOG_PREFIX)

    raw = _strip_code_fences(raw_response)

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"{LOG_PREFIX} Claude returned a response that could not be parsed as "
            f"JSON during field matching. Raw response:\n{raw}"
        ) from exc

    if not isinstance(parsed, dict):
        raise ValueError(
            f"{LOG_PREFIX} Claude returned an unexpected format during field "
            f"matching (expected dict, got {type(parsed).__name__})."
        )

    return parsed
