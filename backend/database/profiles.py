"""
Fillosophy — Active database backend selector.
Set DB_BACKEND=sqlite (default) or DB_BACKEND=supabase in .env
to switch implementations. Routes always import from this file.
"""

import os

from database.sqlite_db import SQLiteProfileDB
from database.supabase_db import SupabaseProfileDB

DB_BACKEND = os.getenv("DB_BACKEND", "sqlite").lower()

if DB_BACKEND == "supabase":
    db = SupabaseProfileDB()
    print("[Fillosophy DB] Using Supabase backend")
else:
    db = SQLiteProfileDB()
    print("[Fillosophy DB] Using SQLite backend")


# Top-level forwarding functions
# Routes import these — never the concrete implementations directly.

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
