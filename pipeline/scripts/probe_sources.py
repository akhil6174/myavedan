"""Check which official sources answer from wherever this runs (used to compare GitHub's US servers with India).

    python pipeline/scripts/probe_sources.py pipeline/sources/national-north.json pipeline/golden/notices.json

Prints one line per URL and a summary. Standard library only. One light GET per URL, 25 s timeout.
"""

from __future__ import annotations

import json
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

USER_AGENT = "MyAvedanSourceCheck/0.1 (+https://myavedan.in/about/#sources)"


def probe(url: str) -> tuple[str, str, float]:
    started = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/pdf,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            res.read(2048)
            return "ok", str(res.status), time.time() - started
    except urllib.error.HTTPError as e:
        return ("blocked" if e.code in (401, 403, 451) else "http_error"), str(e.code), time.time() - started
    except urllib.error.URLError as e:
        reason = e.reason
        if isinstance(reason, ssl.SSLCertVerificationError):
            return "cert_problem", "certificate", time.time() - started
        if isinstance(reason, ssl.SSLError):
            return "tls_problem", type(reason).__name__, time.time() - started
        if isinstance(reason, socket.gaierror):
            return "dns", "no such host", time.time() - started
        if isinstance(reason, (socket.timeout, TimeoutError)):
            return "timeout", "timeout", time.time() - started
        return "error", str(reason)[:60], time.time() - started
    except (socket.timeout, TimeoutError):
        return "timeout", "timeout", time.time() - started
    except Exception as e:  # noqa: BLE001 - report anything else as-is
        return "error", type(e).__name__, time.time() - started


def main(paths: list[str]) -> int:
    targets: list[tuple[str, str]] = []
    for path in paths:
        data = json.load(open(path, encoding="utf-8"))
        for s in data.get("sources", []):
            targets.append((s["id"], s["url"]))
        for n in data.get("notices", []):
            targets.append((f"notice:{n['folder']}", n["source_url"]))

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda t: (t[0], t[1], *probe(t[1])), targets))

    counts: dict[str, int] = {}
    lines = []
    for sid, url, outcome, detail, secs in sorted(results, key=lambda r: (r[2] != "ok", r[0])):
        counts[outcome] = counts.get(outcome, 0) + 1
        lines.append(f"{outcome:13} {detail:14} {secs:5.1f}s  {sid:22} {url}")
    print("\n".join(lines))
    summary = ", ".join(f"{k}: {v}" for k, v in sorted(counts.items()))
    print(f"\nSUMMARY ({len(results)} URLs): {summary}")
    # A GitHub annotation so the result can be read without opening the log.
    failures = [line for line in lines if not line.startswith("ok ")]
    body = f"{summary}%0A" + "%0A".join(failures)
    print(f"::notice title=Source reachability::{body}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
