# backend/app/services/invites.py
import hashlib
import secrets

INVITE_TOKEN_PREFIX = "cei_inv_"  # required format


def generate_invite_token() -> str:
    # Opaque one-time token
    return INVITE_TOKEN_PREFIX + secrets.token_urlsafe(32)


def hash_invite_token(raw_token: str) -> str:
    # SHA-256 hex digest (64 chars)
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()
