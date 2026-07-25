"""
Fillosophy — Abstract database interface.
All database implementations must extend ProfileDB.
Swap implementations in database/profiles.py without touching routes.
"""

from abc import ABC, abstractmethod


class ProfileDB(ABC):

    @abstractmethod
    def init_db(self) -> None:
        """Initialize database schema if not already set up."""
        pass

    @abstractmethod
    def save_profile(self, name: str, data: dict, user_id: str = "00000000-0000-0000-0000-000000000000") -> None:
        """Insert or replace a profile by name for a specific user."""
        pass

    @abstractmethod
    def get_profile(self, name: str, user_id: str = "00000000-0000-0000-0000-000000000000") -> dict | None:
        """Return a profile dict by name for a specific user, or None if not found."""
        pass

    @abstractmethod
    def list_profiles(self, user_id: str = "00000000-0000-0000-0000-000000000000") -> list[str]:
        """Return a list of all saved profile names for a specific user."""
        pass

    @abstractmethod
    def delete_profile(self, name: str, user_id: str = "00000000-0000-0000-0000-000000000000") -> None:
        """Delete a profile by name for a specific user."""
        pass
