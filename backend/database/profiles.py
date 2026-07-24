"""
Fillosophy — Database interface.
Uses SQLiteProfileDB for clean, zero-dependency local profile storage.
"""

from database.sqlite_db import SQLiteProfileDB

db = SQLiteProfileDB()
print("[Fillosophy DB] Initialized SQLite database backend")


# ─── Top-level forwarding functions ───────────────────────────────────────────
# Routes import these functions directly.

def init_db() -> None:
    return db.init_db()


def save_profile(name: str, data: dict) -> None:
    return db.save_profile(name, data)


def get_profile(name: str) -> dict | None:
    return db.get_profile(name)


def list_profiles() -> list[str]:
    return db.list_profiles()


def delete_profile(name: str) -> None:
    return db.delete_profile(name)

