"""
Fillosophy — Database interface.
Uses SupabaseProfileDB for cloud-backed profile storage.
"""

from database.supabase_db import SupabaseProfileDB

db = SupabaseProfileDB()
print("[Fillosophy DB] Initialized Supabase database backend")


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
