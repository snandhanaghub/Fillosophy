"""
Fillosophy — SQLite database implementation.
Stores profiles as JSON blobs in a local SQLite file.
Default database path: fillosophy.db (relative to the backend root).
"""

import json
import logging
import sqlite3

from database.base import ProfileDB

logger = logging.getLogger(__name__)
LOG_PREFIX = "[Fillosophy SQLite]"


class SQLiteProfileDB(ProfileDB):
    """SQLite-backed profile store. Each method opens its own connection."""

    def __init__(self, db_path: str = "fillosophy.db") -> None:
        self.db_path = db_path

    # Schema

    def init_db(self) -> None:
        """Create the profiles table if it does not already exist (idempotent)."""
        conn = None
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS profiles (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    name       TEXT UNIQUE NOT NULL,
                    data       TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()
            logger.info("%s Database ready at: %s", LOG_PREFIX, self.db_path)
        except Exception as exc:
            raise RuntimeError(
                f"{LOG_PREFIX} Failed to initialise database at '{self.db_path}': {exc}"
            ) from exc
        finally:
            if conn:
                conn.close()

    # Write

    def save_profile(self, name: str, data: dict) -> None:
        """Insert or replace a profile. data is serialised to JSON before storage."""
        conn = None
        try:
            logger.info("%s Saving profile '%s'.", LOG_PREFIX, name)
            conn = sqlite3.connect(self.db_path)
            conn.execute(
                "INSERT OR REPLACE INTO profiles (name, data) VALUES (?, ?)",
                (name, json.dumps(data)),
            )
            conn.commit()
            logger.info("%s Profile '%s' saved successfully.", LOG_PREFIX, name)
        except Exception as exc:
            raise RuntimeError(
                f"{LOG_PREFIX} Failed to save profile '{name}': {exc}"
            ) from exc
        finally:
            if conn:
                conn.close()

    # Read

    def get_profile(self, name: str) -> dict | None:
        """Return the profile dict for name, or None if no matching row exists."""
        conn = None
        try:
            logger.info("%s Fetching profile '%s'.", LOG_PREFIX, name)
            conn = sqlite3.connect(self.db_path)
            row = conn.execute(
                "SELECT data FROM profiles WHERE name = ?", (name,)
            ).fetchone()
            if row is None:
                logger.info("%s Profile '%s' not found.", LOG_PREFIX, name)
                return None
            logger.info("%s Profile '%s' retrieved.", LOG_PREFIX, name)
            return json.loads(row[0])
        except Exception as exc:
            raise RuntimeError(
                f"{LOG_PREFIX} Failed to retrieve profile '{name}': {exc}"
            ) from exc
        finally:
            if conn:
                conn.close()

    def list_profiles(self) -> list[str]:
        """Return a list of all profile names ordered by creation time."""
        conn = None
        try:
            logger.info("%s Listing all profiles.", LOG_PREFIX)
            conn = sqlite3.connect(self.db_path)
            rows = conn.execute(
                "SELECT name FROM profiles ORDER BY created_at ASC"
            ).fetchall()
            names = [row[0] for row in rows]
            logger.info("%s Found %d profile(s).", LOG_PREFIX, len(names))
            return names
        except Exception as exc:
            raise RuntimeError(
                f"{LOG_PREFIX} Failed to list profiles: {exc}"
            ) from exc
        finally:
            if conn:
                conn.close()

    # Delete

    def delete_profile(self, name: str) -> None:
        """Delete the profile with the given name (no-op if it does not exist)."""
        conn = None
        try:
            logger.info("%s Deleting profile '%s'.", LOG_PREFIX, name)
            conn = sqlite3.connect(self.db_path)
            conn.execute("DELETE FROM profiles WHERE name = ?", (name,))
            conn.commit()
            logger.info("%s Profile '%s' deleted.", LOG_PREFIX, name)
        except Exception as exc:
            raise RuntimeError(
                f"{LOG_PREFIX} Failed to delete profile '{name}': {exc}"
            ) from exc
        finally:
            if conn:
                conn.close()
