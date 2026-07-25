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


def save_profile(name: str, data: dict, user_id: str = "00000000-0000-0000-0000-000000000000") -> None:
    return db.save_profile(name, data, user_id)


def get_profile(name: str, user_id: str = "00000000-0000-0000-0000-000000000000") -> dict | None:
    return db.get_profile(name, user_id)


def list_profiles(user_id: str = "00000000-0000-0000-0000-000000000000") -> list[str]:
    return db.list_profiles(user_id)


def delete_profile(name: str, user_id: str = "00000000-0000-0000-0000-000000000000") -> None:
    return db.delete_profile(name, user_id)
