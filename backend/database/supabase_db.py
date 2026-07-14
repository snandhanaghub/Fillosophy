"""
Fillosophy — Supabase database implementation (stub).
To activate: set DB_BACKEND=supabase in .env, install supabase-py,
and implement each method using the Supabase Python client.
See SUPABASE_SETUP.md for full migration instructions.
"""

import logging
import os

from database.base import ProfileDB

logger = logging.getLogger(__name__)
LOG_PREFIX = "[Fillosophy Supabase]"

_NOT_IMPLEMENTED_MSG = (
    "Supabase implementation not yet active. "
    "See SUPABASE_SETUP.md to enable cloud storage."
)


class SupabaseProfileDB(ProfileDB):
    """
    Stub Supabase implementation of ProfileDB.

    Reads connection details from the environment but does not import or
    initialise the supabase-py client until this class is fully implemented.
    All methods raise NotImplementedError until then.
    """

    def __init__(self) -> None:
        self.url = os.environ.get("SUPABASE_URL", "")
        self.key = os.environ.get("SUPABASE_KEY", "")
        logger.info(
            "%s Initialized with URL: %s...",
            LOG_PREFIX,
            self.url[:30] if self.url else "(not set)",
        )

    # Stub methods

    def init_db(self) -> None:
        """Not yet implemented — see SUPABASE_SETUP.md."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    def save_profile(self, name: str, data: dict) -> None:
        """Not yet implemented — see SUPABASE_SETUP.md."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    def get_profile(self, name: str) -> dict | None:
        """Not yet implemented — see SUPABASE_SETUP.md."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    def list_profiles(self) -> list[str]:
        """Not yet implemented — see SUPABASE_SETUP.md."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)

    def delete_profile(self, name: str) -> None:
        """Not yet implemented — see SUPABASE_SETUP.md."""
        raise NotImplementedError(_NOT_IMPLEMENTED_MSG)
