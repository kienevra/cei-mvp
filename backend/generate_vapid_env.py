"""
generate_vapid_env.py
---------------------
Run once to convert your PEM keys into .env-ready single-line values.
Output lines go directly into backend/.env

Run from: C:\\dev\\cei-mvp\\backend
Usage: python generate_vapid_env.py
"""
from py_vapid import Vapid
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
import base64

PRIVATE_PEM = b"""-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgKu4eBtXGIYes1EnQ
VLEKJRl2s2SiQLIMVARR9cMUkkuhRANCAARarG2lJkU0mthzVGQShLMtbkODuE/Q
CRSjeBXLoR4udEADbJ9gHcfHNid9Vb0vHdtg4aKpFxiTJCoaTH2HkEgG
-----END PRIVATE KEY-----"""

v = Vapid.from_pem(PRIVATE_PEM)

# Raw 32-byte private scalar → base64url (pywebpush accepts this directly)
raw_priv = v.private_key.private_numbers().private_value.to_bytes(32, "big")
b64_priv = base64.urlsafe_b64encode(raw_priv).rstrip(b"=").decode()

# Uncompressed EC point (65 bytes, 0x04 prefix) → base64url (browser applicationServerKey)
raw_pub = v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
b64_pub = base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode()

print("# ── Add these three lines to backend/.env ──────────────────────────")
print(f"VAPID_PRIVATE_KEY={b64_priv}")
print(f"VAPID_PUBLIC_KEY={b64_pub}")
print("VAPID_CLAIMS_EMAIL=support@carbonefficiencyintel.com")
print("# ────────────────────────────────────────────────────────────────────")
print()
print("# Also add to frontend/.env (Vite needs the public key):")
print(f"VITE_VAPID_PUBLIC_KEY={b64_pub}")