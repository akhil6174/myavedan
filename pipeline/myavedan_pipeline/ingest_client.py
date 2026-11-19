"""Send a draft to the Worker's Ingest API, signed with HMAC-SHA256.

The signature covers f"{timestamp}.{body}", matching apps/api/src/crypto.ts.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.request
from typing import Any


def sign(secret: str, body: str, timestamp: int) -> str:
    return hmac.new(secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()


def post_draft(ingest_url: str, secret: str, payload: dict[str, Any], timeout: float = 30.0) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    ts = int(time.time())
    request = urllib.request.Request(
        ingest_url,
        data=body.encode(),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-MyAvedan-Timestamp": str(ts),
            "X-MyAvedan-Signature": sign(secret, body, ts),
            "User-Agent": "MyAvedanPipeline/0.1",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - URL comes from configuration
        return json.loads(response.read().decode())
