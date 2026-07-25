"""
Fillosophy — Supabase database implementation.
Stores profiles as JSON blobs in a Supabase Postgres table.

Expected table schema (run once in the Supabase SQL editor):

    CREATE TABLE IF NOT EXISTS profiles (
        id         BIGSERIAL PRIMARY KEY,
        name       TEXT UNIQUE NOT NULL,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

Environment variables required:
    SUPABASE_URL  — e.g. https://xxxx.supabase.co
    SUPABASE_KEY  — service role key or anon key with RLS disabled
"""

import json
import logging
import os

from database.base import ProfileDB

logger = logging.getLogger(__name__)
LOG_PREFIX = "[Fillosophy Supabase]"


def _get_client():
    """Lazy-initialise the Supabase client (once) on first call."""
    if not hasattr(_get_client, "_instance"):
        from supabase import create_client, Client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")

        if not url or not key:
            raise RuntimeError(
                f"{LOG_PREFIX} SUPABASE_URL and SUPABASE_KEY must be set in .env "
                "when using the Supabase backend."
            )

        _get_client._instance: Client = create_client(url, key)
        logger.info("%s Supabase client initialised (URL: %s)", LOG_PREFIX, url)
        print(f"{LOG_PREFIX} Connected to Supabase at {url}")

    return _get_client._instance


def get_client():
    """Public accessor for the Supabase client."""
    return _get_client()


class SupabaseProfileDB(ProfileDB):
    """Supabase-backed profile store. Uses the `profiles` table."""

    TABLE = "profiles"

    # ─── Schema ───────────────────────────────────────────────────────────────

    def init_db(self) -> None:
        """
        Validate connectivity and confirm the profiles table is reachable.
        The table must already exist — create it via the SQL editor (see module docstring).
        """
        try:
            client = _get_client()
            # A lightweight query to confirm the table exists and is reachable
            client.table(self.TABLE).select("id").limit(1).execute()
            logger.info("%s profiles table reachable.", LOG_PREFIX)
            print(f"{LOG_PREFIX} Database ready — profiles table confirmed.")
        except Exception as exc:
            raise RuntimeError(
                f"{LOG_PREFIX} Failed to connect to Supabase or 'profiles' table "
                f"not found. Check your credentials and run the CREATE TABLE SQL. "
                f"Error: {exc}"
            ) from exc

    # ─── Write ────────────────────────────────────────────────────────────────

    def save_profile(self, name: str, data: dict) -> None:
        """Insert or replace a profile. Uses upsert on the `name` unique column."""
        try:
            logger.info("%s Saving profile '%s'.", LOG_PREFIX, name)
            client = _get_client()
            client.table(self.TABLE).upsert(
                {"name": name, "data": data},
                on_conflict="name",
            ).execute()
            logger.info("%s Profile '%s' saved successfully.", LOG_PREFIX, name)
        except Exception as exc:
            raise RuntimeError(
                f"{LOG_PREFIX} Failed to save profile '{name}': {exc}"
            ) from exc

    # ─── Read ─────────────────────────────────────────────────────────────────

    def get_profile(self, name: str) -> dict | None:
        """Return the profile dict for name, or None if no matching row exists."""
        try:
            logger.info("%s Fetching profile '%s'.", LOG_PREFIX, name)
            client = _get_client()
            result = (
                client.table(self.TABLE)
                .select("data")
                .eq("name", name)
                .limit(1)
                .execute()
            )
            rows = result.data
            if not rows:
                logger.info("%s Profile '%s' not found.", LOG_PREFIX, name)
                return None
            logger.info("%s Profile '%s' retrieved.", LOG_PREFIX, name)
            raw = rows[0]["data"]
            # Supabase returns JSONB columns as Python dicts already
            return raw if isinstance(raw, dict) else json.loads(raw)
        except Exception as exc:
            raise RuntimeError(
                f"{LOG_PREFIX} Failed to retrieve profile '{name}': {exc}"
            ) from exc

    def list_profiles(self) -> list[str]:
        """Return a list of all profile names ordered by creation time."""
        try:
            logger.info("%s Listing all profiles.", LOG_PREFIX)
            client = _get_client()
            result = (
                client.table(self.TABLE)
                .select("name")
                .order("created_at", desc=False)
                .execute()
            )
            names = [row["name"] for row in result.data]
            logger.info("%s Found %d profile(s).", LOG_PREFIX, len(names))
            return names
        except Exception as exc:
            raise RuntimeError(
                f"{LOG_PREFIX} Failed to list profiles: {exc}"
            ) from exc

    # ─── Delete ───────────────────────────────────────────────────────────────

    def delete_profile(self, name: str) -> None:
        """Delete the profile with the given name (no-op if it does not exist)."""
        try:
            logger.info("%s Deleting profile '%s'.", LOG_PREFIX, name)
            client = _get_client()
            client.table(self.TABLE).delete().eq("name", name).execute()
            logger.info("%s Profile '%s' deleted.", LOG_PREFIX, name)
        except Exception as exc:
            raise RuntimeError(
                f"{LOG_PREFIX} Failed to delete profile '{name}': {exc}"
            ) from exc
