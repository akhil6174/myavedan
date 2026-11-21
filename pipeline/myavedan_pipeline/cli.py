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
from concurrent.futures import ThreadPoolExecutor, as_completed

from .compact import compact_pages
from .convert import ground_and_flag, to_draft
from .discover import MAX_PDF_BYTES, Candidate, Fetcher, State, find_notice_pdf, is_pdf, notice_score, scan_source
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
    return process_bytes(pdf.read_bytes(), str(pdf.relative_to(ROOT)), source=source, document_url=document_url, dry_run=dry_run, model=model)


def process_bytes(data: bytes, label: str, *, source: dict, document_url: str, dry_run: bool, model: str | None, kind: str = "notice", insecure_tls: bool = False) -> dict:
    digest = sha256_hex(data)
    started = time.time()
    parsed = parse_pdf(data)
    pages = {p.number: p.text for p in parsed}
    unread = [p.number for p in parsed if len(p.text.strip()) < 40]
    coverage = coverage_report(section_map([p.text for p in parsed]))

    readable = [(n, t) for n, t in sorted(pages.items()) if n not in unread]
    today = datetime.now(IST).date().isoformat()
    org = organization_for(source, document_url)
    hosts = sorted({host(source["url"]), host(document_url)})

    extraction, usage = gemini.extract(compact_pages(readable), model=model)
    draft = to_draft(extraction, organization=org, notice_url=document_url, official_page=source["url"], today=today)
    draft, flags = ground_and_flag(draft, pages, hosts, unread)
    if insecure_tls:
        flags.append({"field": "links.notice_pdf", "code": "insecure_tls", "severity": "warning",
                      "message": "The official site's security certificate couldn't be verified when downloading. Open the notice from the official site yourself to confirm it is genuine."})
    for missing in coverage["missing_sections"]:
        flags.append({"field": "summary", "code": "section_not_found", "severity": "warning", "message": f"No page looked like a '{missing}' section"})

    payload = {
        "source_url": source["url"],
        "document_url": document_url,
        "document_kind": kind,
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
        "pdf": label,
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


def _run_parallel(jobs: list, workers: int) -> int:
    """Run (label, callable) jobs, a few at a time; print one JSON line each. Returns the failure count."""
    failed = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(fn): label for label, fn in jobs}
        for fut in as_completed(futures):
            try:
                print(json.dumps(fut.result(), ensure_ascii=False))
            except Exception as e:  # report and continue with the others
                failed += 1
                print(json.dumps({"pdf": futures[fut], "error": str(e)[:400]}, ensure_ascii=False))
            sys.stdout.flush()
    return failed


def load_sources() -> dict[str, dict]:
    return {s["id"]: s for s in json.loads((ROOT / "sources" / "national-north.json").read_text(encoding="utf-8"))["sources"]}


def cmd_golden(args: argparse.Namespace) -> int:
    notices = json.loads((ROOT / "golden" / "notices.json").read_text(encoding="utf-8"))["notices"]
    sources = load_sources()
    jobs = []
    for n in notices:
        if args.only and n["folder"] not in args.only:
            continue
        pdf = ROOT / "golden" / n["folder"] / n["file"]
        jobs.append((n["folder"], lambda pdf=pdf, n=n: process(pdf, source=sources[n["source_id"]], document_url=n["source_url"], dry_run=args.dry_run, model=args.model)))
    return 1 if _run_parallel(jobs, args.workers) else 0


# Extra official hosts some organisations publish on (keep in step with scripts/sources_sql.py).
EXTRA_HOSTS = {"sbi": ["sbi.co.in"], "rrb-apply": ["rrbapply.gov.in"]}


def state_path() -> Path:
    return Path(os.environ.get("MYAVEDAN_STATE", Path.home() / ".myavedan" / "reader-state.json"))


def cmd_discover(args: argparse.Namespace) -> int:
    sources = [s for s in load_sources().values() if s.get("approved_by_owner") and (not args.sources or s["id"] in args.sources)]
    state = State.load(state_path())
    fetcher = Fetcher()
    now = datetime.now(IST).replace(microsecond=0).isoformat()
    todo: list[Candidate] = []
    links_found: list[tuple[dict, Candidate]] = []

    for s in sources:
        hosts = sorted({host(s["url"]), *EXTRA_HOSTS.get(s["id"], [])})
        first_visit = not state.sources.get(s["id"], {}).get("checked_at")
        found, report = scan_source(fetcher, s, hosts, state)
        for c in found:
            if first_visit:
                # Old notices already on the site: remember them, don't read them all at once.
                state.seen_urls[c.key] = {"url": c.url, "source": c.source_id, "kind": c.kind, "text": c.text, "status": "backlog", "first_seen": now}
            elif c.kind == "notice":
                todo.append(c)
            else:
                # Apply pages, admit cards, keys, results, cut-offs, corrigenda: no AI needed.
                # Sent in one batch below; the API suggests the matching recruitment.
                links_found.append((s, c))
        if first_visit:
            report["first_visit_backlog"] = len(found)
        print(json.dumps({"scan": report}, ensure_ascii=False))
        sys.stdout.flush()
        state.save()

    if links_found:
        sent = send_links(links_found, dry_run=args.dry_run)
        for _, c in links_found:
            state.seen_urls[c.key] = {"url": c.url, "source": c.source_id, "kind": c.kind, "text": c.text, "status": "link_sent" if sent else "link_pending", "first_seen": now}
        print(json.dumps({"links_found": len(links_found), "sent": sent}))
        state.save()

    # Daily Gemini cap, counted in IST days across runs.
    today = datetime.now(IST).date().isoformat()
    used = state.usage.get(today, 0)
    allowed = max(0, int(os.environ.get("GEMINI_DAILY_LIMIT", "16")) - used)
    want_new = min(len(todo), args.max_new, allowed)
    want_backlog = min(args.from_backlog, max(0, allowed - want_new))

    # Backlog: the most likely current notification PDFs first.
    year = today[:4]
    backlog = sorted(
        (
            Candidate(v["source"], v.get("url", key), v.get("text", ""), v["kind"], key)
            for key, v in state.seen_urls.items()
            if v.get("status") == "backlog" and v.get("kind") == "notice" and (not args.sources or v["source"] in args.sources)
        ),
        key=lambda c: -notice_score(c.text, c.url, year),
    )
    print(json.dumps({"new_notices": len(todo), "reading_new": want_new, "reading_backlog": want_backlog, "gemini_calls_today": used, "daily_limit_left": allowed}))

    srcs = load_sources()
    downloads = []
    # Keep trying candidates until enough real PDFs are in hand (some links are web pages or dead).
    for pool, wanted in ((todo, want_new), (backlog, want_backlog)):
        got_count, tries = 0, 0
        for c in pool:
            if got_count >= wanted or tries >= wanted * 4 + 2:
                break
            tries += 1
            got = _download_notice(fetcher, c, srcs[c.source_id])
            if got is None:
                state.seen_urls[c.key] = {"url": c.url, "source": c.source_id, "kind": c.kind, "text": c.text, "status": "not_pdf", "first_seen": now}
                continue
            downloads.append((c, got))
            got_count += 1
    if downloads and not args.dry_run:
        known = set(known_hashes([sha256_hex(g.body) for _, g in downloads]))
    else:
        known = set()

    jobs = []
    for c, got in downloads:
        digest = sha256_hex(got.body)
        if digest in known:
            state.seen_urls[c.key] = {"url": c.url, "source": c.source_id, "kind": c.kind, "text": c.text, "status": "already_sent", "sha256": digest, "first_seen": now}
            continue
        jobs.append((c.url, lambda c=c, got=got: _read_and_mark(state, c, got, srcs[c.source_id], args, now)))
    failed = _run_parallel(jobs, args.workers)
    state.save()
    return 1 if failed else 0


def _download_notice(fetcher: Fetcher, c: Candidate, source: dict):
    """The notice PDF behind a link: the link itself, or the PDF on the page it opens. None if neither."""
    try:
        got = fetcher.get(c.url, max_bytes=MAX_PDF_BYTES)
        if is_pdf(got.body):
            return got
        if b"<html" in got.body[:4000].lower() or b"<!doctype" in got.body[:4000].lower():
            hosts = sorted({host(source["url"]), host(c.url), *EXTRA_HOSTS.get(source["id"], [])})
            inner = find_notice_pdf(got.body.decode("utf-8", errors="replace"), got.url, hosts)
            if inner:
                got2 = fetcher.get(inner, max_bytes=MAX_PDF_BYTES)
                if is_pdf(got2.body):
                    print(json.dumps({"followed_page_to_pdf": c.url, "pdf": inner}))
                    return got2
    except Exception as e:  # dead or slow link: count as unreadable this time
        print(json.dumps({"download_failed": c.url, "error": str(e)[:200]}))
    return None


def _read_and_mark(state: State, c: Candidate, got, source: dict, args: argparse.Namespace, now: str) -> dict:
    day = datetime.now(IST).date().isoformat()
    state.usage[day] = state.usage.get(day, 0) + 1  # count the attempt: failures use quota too
    result = process_bytes(got.body, c.url, source=source, document_url=got.url, dry_run=args.dry_run, model=args.model, kind=c.kind, insecure_tls=got.insecure_tls)
    state.seen_urls[c.key] = {"url": c.url, "source": c.source_id, "kind": c.kind, "text": c.text, "status": "dry_run" if args.dry_run else "sent", "sha256": sha256_hex(got.body), "first_seen": now}
    return result


def send_links(found: list[tuple[dict, Candidate]], dry_run: bool) -> bool:
    """One signed request for every link found in this run. Returns True if the API stored them."""
    if dry_run:
        return False
    url, secret = os.environ.get("INGEST_URL"), os.environ.get("INGEST_HMAC_SECRET")
    if not url or not secret:
        return False
    body = {"links": [{"source_url": s["url"], "url": c.url, "kind": c.kind, "link_text": c.text or c.url} for s, c in found][:300]}
    try:
        post_draft(url.rstrip("/") + "/links", secret, body)
        return True
    except Exception as e:  # keep them as pending; the next run sends them again
        print(json.dumps({"links_send_failed": str(e)[:200]}))
        return False


def known_hashes(hashes: list[str]) -> list[str]:
    url, secret = os.environ.get("INGEST_URL"), os.environ.get("INGEST_HMAC_SECRET")
    if not url or not secret:
        return []
    try:
        return post_draft(url.rstrip("/") + "/known", secret, {"sha256": hashes}).get("known", [])
    except Exception:  # the server will still refuse duplicates; this only saves AI quota
        return []


def main() -> int:
    load_env()
    parser = argparse.ArgumentParser(prog="myavedan-reader")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("models")
    sub.add_parser("scheduled", help="run with settings from READER_* environment variables (used by the workflow)")
    g = sub.add_parser("golden")
    g.add_argument("--only", nargs="*", help="folders to process, e.g. ssc ibps")
    d = sub.add_parser("discover")
    d.add_argument("--sources", nargs="*", help="source ids to check (default: all approved)")
    d.add_argument("--max-new", type=int, default=10, help="most notices to read in one run")
    d.add_argument("--from-backlog", type=int, default=0, help="also read up to N notices found on earlier first visits")
    for p in (g, d):
        p.add_argument("--dry-run", action="store_true", help="save results locally, send nothing")
        p.add_argument("--model", help="Gemini model (default: GEMINI_MODEL or gemini.DEFAULT_MODEL)")
        p.add_argument("--workers", type=int, default=1, help="notices read at the same time (the free tier slows down above 1)")
    args = parser.parse_args()
    if args.cmd == "models":
        for m in gemini.list_models(os.environ.get("GEMINI_API_KEY", "")):
            print(m)
        return 0
    if args.cmd == "scheduled":
        # Same command on Windows and Linux runners; the workflow passes its inputs as environment variables.
        mode = os.environ.get("READER_MODE", "discover")
        argv = [mode]
        if mode == "discover":
            argv += ["--max-new", os.environ.get("READER_MAX_NEW", "10"), "--from-backlog", os.environ.get("READER_FROM_BACKLOG", "0")]
        if os.environ.get("READER_DRY_RUN", "false").lower() == "true":
            argv.append("--dry-run")
        args = parser.parse_args(argv)
    return cmd_discover(args) if args.cmd == "discover" else cmd_golden(args)


if __name__ == "__main__":
    sys.exit(main())
