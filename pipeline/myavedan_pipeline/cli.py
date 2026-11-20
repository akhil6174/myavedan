"""Notice reader command line.

    python -m myavedan_pipeline.cli models                     list Gemini models this key can use
    python -m myavedan_pipeline.cli golden --dry-run           read the test notices, save results, send nothing
    python -m myavedan_pipeline.cli golden --only ssc          read one test notice and send it to staging for review

Settings come from pipeline/.env (local) or environment variables (GitHub Actions):
GEMINI_API_KEY, GEMINI_MODEL (optional), INGEST_URL, INGEST_HMAC_SECRET.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from . import gemini
from .convert import ground_and_flag, to_draft
from .fingerprint import sha256_hex
from .ingest_client import post_draft
from .sections import coverage_report, section_map
from .stages import parse_pdf

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache"
IST = timezone(timedelta(hours=5, minutes=30))
STATE_NAMES = {
    "uttar-pradesh": "Uttar Pradesh", "uttarakhand": "Uttarakhand", "himachal-pradesh": "Himachal Pradesh", "punjab": "Punjab",
    "haryana": "Haryana", "delhi": "Delhi", "chandigarh": "Chandigarh", "jammu-kashmir": "Jammu and Kashmir", "ladakh": "Ladakh", "rajasthan": "Rajasthan",
}
UTS = {"delhi", "chandigarh", "jammu-kashmir", "ladakh"}


def load_env() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                if v.strip() and not os.environ.get(k.strip()):
                    os.environ[k.strip()] = v.strip()


def host(url: str) -> str:
    return (urlparse(url).hostname or "").removeprefix("www.")


def organization_for(source: dict, document_url: str) -> dict:
    region = source["region"]
    jurisdiction = "central" if region == "national" else ("ut" if region in UTS else "state")
    return {
        "name": source["organization"],
        "jurisdiction": jurisdiction,
        "state": None if region == "national" else STATE_NAMES.get(region, region),
        "domain": host(document_url),
    }


def chunks_from(pages: dict[int, str]) -> list[dict]:
    out = []
    for n, text in sorted(pages.items()):
        text = text.strip()
        for start in range(0, len(text), 7500):
            piece = text[start : start + 7500].strip()
            if piece:
                out.append({"page": n, "section": None, "text": piece})
    return out[:2000]


def process(pdf: Path, *, source: dict, document_url: str, dry_run: bool, model: str | None) -> dict:
    data = pdf.read_bytes()
    digest = sha256_hex(data)
    started = time.time()
    parsed = parse_pdf(data)
    pages = {p.number: p.text for p in parsed}
    unread = [p.number for p in parsed if len(p.text.strip()) < 40]
    coverage = coverage_report(section_map([p.text for p in parsed]))

    readable = [(n, t) for n, t in sorted(pages.items()) if n not in unread]
    extraction, usage = gemini.extract(readable, model=model)

    today = datetime.now(IST).date().isoformat()
    org = organization_for(source, document_url)
    draft = to_draft(extraction, organization=org, notice_url=document_url, official_page=source["url"], today=today)
    hosts = sorted({host(source["url"]), host(document_url)})
    draft, flags = ground_and_flag(draft, pages, hosts, unread)
    for missing in coverage["missing_sections"]:
        flags.append({"field": "summary", "code": "section_not_found", "severity": "warning", "message": f"No page looked like a '{missing}' section"})

    payload = {
        "source_url": source["url"],
        "document_url": document_url,
        "document_kind": "notice",
        "sha256": digest,
        "r2_key": f"raw/{source['id']}/{digest}.pdf",
        "bytes": len(data),
        "pages": len(parsed),
        "retrieved_at": datetime.now(IST).replace(microsecond=0).isoformat(),
        "advt_no": draft.get("advt_no"),
        "draft": draft,
        "flags": flags,
        "chunks": chunks_from(pages),
    }
    out_dir = CACHE / digest[:16]
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "extraction.json").write_text(json.dumps(extraction, indent=2, ensure_ascii=False), encoding="utf-8")
    (out_dir / "payload.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    grounded = sum(1 for g in draft["grounding"].values() if g["grounded"])
    summary = {
        "pdf": str(pdf.relative_to(ROOT)),
        "pages": len(parsed),
        "unread_pages": unread,
        "posts": len(draft["posts"]),
        "dates": len(draft["dates"]),
        "fees": len(draft["fees"]),
        "grounded": f"{grounded}/{len(draft['grounding'])}",
        "errors": sum(f["severity"] == "error" for f in flags),
        "warnings": sum(f["severity"] == "warning" for f in flags),
        "tokens_in": usage.get("promptTokenCount"),
        "tokens_out": usage.get("candidatesTokenCount"),
        "model": usage.get("model"),
        "seconds": round(time.time() - started, 1),
        "saved": str(out_dir.relative_to(ROOT)),
    }
    if not dry_run:
        url, secret = os.environ.get("INGEST_URL"), os.environ.get("INGEST_HMAC_SECRET")
        if not url or not secret:
            raise SystemExit("INGEST_URL and INGEST_HMAC_SECRET are needed to send drafts (or use --dry-run)")
        summary["ingest"] = post_draft(url, secret, payload)
    return summary


def cmd_golden(args: argparse.Namespace) -> int:
    notices = json.loads((ROOT / "golden" / "notices.json").read_text(encoding="utf-8"))["notices"]
    sources = {s["id"]: s for s in json.loads((ROOT / "sources" / "national-north.json").read_text(encoding="utf-8"))["sources"]}
    failed = 0
    for n in notices:
        if args.only and n["folder"] not in args.only:
            continue
        pdf = ROOT / "golden" / n["folder"] / n["file"]
        try:
            result = process(pdf, source=sources[n["source_id"]], document_url=n["source_url"], dry_run=args.dry_run, model=args.model)
            print(json.dumps(result, ensure_ascii=False))
        except Exception as e:  # report and continue with the next notice
            failed += 1
            print(json.dumps({"pdf": n["folder"], "error": str(e)[:400]}))
        sys.stdout.flush()
    return 1 if failed else 0


def main() -> int:
    load_env()
    parser = argparse.ArgumentParser(prog="myavedan-reader")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("models")
    g = sub.add_parser("golden")
    g.add_argument("--only", nargs="*", help="folders to process, e.g. ssc ibps")
    g.add_argument("--dry-run", action="store_true", help="save results locally, send nothing")
    g.add_argument("--model", help="Gemini model (default: GEMINI_MODEL or gemini.DEFAULT_MODEL)")
    args = parser.parse_args()
    if args.cmd == "models":
        for m in gemini.list_models(os.environ.get("GEMINI_API_KEY", "")):
            print(m)
        return 0
    return cmd_golden(args)


if __name__ == "__main__":
    sys.exit(main())
