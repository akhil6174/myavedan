"""Stage 03: fingerprint downloaded files so the same bytes are never processed twice."""

from __future__ import annotations

import hashlib


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def r2_key(org_id: str, digest: str, extension: str = "pdf") -> str:
    """Raw files are stored by content hash, so re-uploads are idempotent."""
    return f"raw/{org_id}/{digest}.{extension}"
