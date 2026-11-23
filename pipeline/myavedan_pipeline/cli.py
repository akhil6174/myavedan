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
import re
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
from .discover import looks_outdated, looks_recent, read_priority, take_turns, MAX_PDF_BYTES, Candidate, Fetcher, State, find_notice_pdf, is_pdf, notice_score, scan_source
from .fingerprint import sha256_hex
from .ingest_client import post_draft
from .normalise import page_text
from .crosscheck import crosscheck
from .sections import coverage_report, section_map
from .stages import parse_pdf

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache"
IST = timezone(timedelta(hours=5, minutes=30))
STATE_NAMES = {
    "uttar-pradesh": "Uttar Pradesh", "uttarakhand": "Uttarakhand", "himachal-pradesh": "Himachal Pradesh", "punjab": "Punjab",
    "haryana": "Haryana", "delhi": "Delhi", "chandigarh": "Chandigarh", "jammu-kashmir": "Jammu and Kashmir", "ladakh": "Ladakh", "rajasthan": "Rajasthan",
}
KINDS = {"notice", "corrigendum", "admit_card", "answer_key", "result", "cutoff", "other"}
UTS = {"delhi", "chandigarh", "jammu-kashmir", "ladakh"}


def outdated_reason(draft: dict, kind: str, today: str) -> str | None:
    """Not worth listing any more: an opening whose application window and exam are over, or an
    update (result, admit card...) whose dates are all more than 60 days old."""
    days = {}
    for d in draft.get("dates") or []:
        v = d.get("value")
        if isinstance(v, str) and len(v) >= 10:
            days.setdefault(d.get("kind"), []).append(v[:10])
    every = [v for vs in days.values() for v in vs]
    if not every:
        return None
    if kind == "notice":
        future = [v for k in ("apply_end", "fee_end", "correction_end", "exam", "admit_card", "result") for v in days.get(k, []) if v >= today]
        if days.get("apply_end") and not future:
            return f"applications closed on {max(days['apply_end'])}"
        return None
    cutoff = (datetime.fromisoformat(today) - timedelta(days=60)).date().isoformat()
    if max(every) < cutoff:
        return f"latest date in it is {max(every)}"
    return None


def load_env() -> None:
    """~/.myavedan/.env (next to the reader state: the PC's production settings) wins, then
    pipeline/.env (hand testing, often staging) fills anything missing. Real environment variables win over both."""
    for env in (state_path().parent / ".env", ROOT / ".env"):
        if not env.exists():
            continue
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                if v.strip() and not os.environ.get(k.strip()):
                    os.environ[k.strip()] = v.strip().strip('"')


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
    # Hindi digits/terms normalised and tables added as Markdown; used for reading AND fact-checking.
    pages = {p.number: page_text(p.text, p.tables) for p in parsed}
    unread = [p.number for p in parsed if len(p.text.strip()) < 40]
    coverage = coverage_report(section_map([p.text for p in parsed]))

    readable = [(n, t) for n, t in sorted(pages.items()) if n not in unread]
    today = datetime.now(IST).date().isoformat()
    org = organization_for(source, document_url)
    hosts = sorted({host(source["url"]), host(document_url)})

    extraction, usage = gemini.extract_resilient(compact_pages(readable), model=model)
    draft = to_draft(extraction, organization=org, notice_url=document_url, official_page=source["url"], today=today)
    draft, flags = ground_and_flag(draft, pages, hosts, unread)
    flags += crosscheck(draft, pages)  # second, rule-based read of last date, vacancies, age, fee
    read_kind = extraction.get("document_kind")
    stale = outdated_reason(draft, read_kind if read_kind in KINDS else kind, today)
    if stale:
        return {"pdf": label, "outdated": stale, "model": usage.get("model")}
    if read_kind in KINDS and read_kind != kind:
        flags.append({"field": "document_kind", "code": "kind_from_content", "severity": "warning",
                      "message": f"The link looked like a '{kind}', but the document reads as a '{read_kind}'. Filed as '{read_kind}'."})
        kind = read_kind
    if usage.get("lite"):
        flags.append({"field": "posts", "code": "lite_model", "severity": "warning",
                      "message": "Read by the lite model because Google's main models were busy. It can miss posts: check the vacancy table in the PDF."})
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
        "fallback_from": usage.get("fallback_from"),
        "seconds": round(time.time() - started, 1),
        "saved": str(out_dir.relative_to(ROOT)),
    }
    if not dry_run:
        url, secret = os.environ.get("INGEST_URL"), os.environ.get("INGEST_HMAC_SECRET")
        if not url or not secret:
            raise SystemExit("INGEST_URL and INGEST_HMAC_SECRET are needed to send drafts (or use --dry-run)")
        summary["ingest"] = post_draft(url, secret, payload)
    return summary


def _run_parallel(jobs: list, workers: int, results: list | None = None) -> int:
    """Run (label, callable) jobs, a few at a time; print one JSON line each. Returns the failure count."""
    failed = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(fn): label for label, fn in jobs}
        for fut in as_completed(futures):
            try:
                out = fut.result()
            except Exception as e:  # report and continue with the others
                failed += 1
                out = {"pdf": futures[fut], "error": str(e)[:400]}
            if results is not None:
                results.append(out)
            print(json.dumps(out, ensure_ascii=False))
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
    if (args.max_new or args.from_backlog) and not os.environ.get("GEMINI_API_KEY"):
        print(json.dumps({"error": f"GEMINI_API_KEY is not set. Put it in {state_path().parent / '.env'} on the PC that runs the reader."}))
        return 1
    sources = [s for s in load_sources().values() if s.get("approved_by_owner") and (not args.sources or s["id"] in args.sources)]
    state = State.load(state_path())
    fetcher = Fetcher()
    now = datetime.now(IST).replace(microsecond=0).isoformat()
    started = now
    today_iso = now[:10]
    todo: list[Candidate] = []
    links_found: list[tuple[dict, Candidate]] = []
    site_reports: list[dict] = []
    unsure_found: list[tuple[dict, Candidate]] = []
    counts = {"sites": 0, "sites_failed": 0, "new_found": 0, "outdated_skipped": 0, "unsure": 0}

    # Links a reviewer marked "read this" in the console's Unsure list.
    srcs_by_url = {s["url"]: s for s in load_sources().values()}
    for q in take_queued(args.dry_run):
        src = srcs_by_url.get(q["source_url"])
        if src:
            todo.append(Candidate(src["id"], q["url"], q.get("link_text", "")[:200], q["kind"], "queued:" + q["url"]))
    counts["from_unsure"] = len(todo)

    for s in sources:
        hosts = sorted({host(s["url"]), *EXTRA_HOSTS.get(s["id"], []), *(host(u) for u in s.get("extra_pages", []))})
        main_report: dict = {}
        new_here = 0
        # The site's own page first, then any list pages it has (notices, results, admit cards...).
        for i, page_url in enumerate([s["url"], *s.get("extra_pages", [])]):
            page_id = s["id"] if i == 0 else f"{s['id']}@{i}"
            first_visit = not state.sources.get(page_id, {}).get("checked_at")
            found, report = scan_source(fetcher, {"id": page_id, "url": page_url}, hosts, state)
            for c in found:
                c.source_id = s["id"]
            unsure = report.pop("_unsure", [])
            for c in unsure:
                c.source_id = s["id"]
            # The first scan with the Unsure list only records what is already there; later scans list what's new.
            baseline = first_visit or not state.sources.get(page_id, {}).get("unsure_baseline")
            if report.get("result") == "ok":
                state.sources.setdefault(page_id, {})["unsure_baseline"] = True
            for c in unsure:
                if c.key in state.seen_urls:
                    continue
                if baseline:
                    state.seen_urls[c.key] = {"url": c.url, "source": c.source_id, "kind": "unsure", "text": c.text, "status": "unsure_old", "first_seen": now}
                else:
                    unsure_found.append((s, c))
            for c in found:
                if c.key in state.seen_urls and state.seen_urls[c.key].get("status") != "link_pending":
                    continue  # already seen on another page of this site
                if looks_outdated(c.text, c.url, today_iso):
                    # Names only long-past dates or years: never read, never listed.
                    state.seen_urls[c.key] = {"url": c.url, "source": c.source_id, "kind": c.kind, "text": c.text, "status": "outdated", "first_seen": now}
                    counts["outdated_skipped"] += 1
                elif first_visit:
                    # Already on the page at the first visit: only recent ones are read (from the
                    # backlog, a few per run); older ones are remembered and left alone.
                    recent = looks_recent(c.text, c.url, today_iso)
                    state.seen_urls[c.key] = {"url": c.url, "source": c.source_id, "kind": c.kind, "text": c.text,
                                              "status": "backlog" if recent else "before_launch", "first_seen": now}
                elif c.kind == "apply_link":
                    # Apply pages: no document to read. Sent in one batch; the API suggests the recruitment.
                    links_found.append((s, c))
                    new_here += 1
                else:
                    # Notices, results, admit cards, answer keys, cut-offs, corrigenda: all read, so each
                    # becomes a draft filed by what it actually is.
                    todo.append(c)
                    new_here += 1
            if first_visit:
                report["first_visit"] = len(found)
            if i == 0:
                main_report = report
            elif str(report.get("result", "")).startswith("failed"):
                print(json.dumps({"list_page_failed": page_url, "result": report["result"]}))
            print(json.dumps({"scan": report}, ensure_ascii=False))
            sys.stdout.flush()
            state.save()
        counts["sites"] += 1
        counts["new_found"] += new_here
        site_reports.append(site_report(s, main_report, new_here))
        if site_reports[-1]["result"] in ("failed", "blocked"):
            counts["sites_failed"] += 1

    counts["unsure"] = len(unsure_found)

    if links_found:
        sent = send_links(links_found, dry_run=args.dry_run)
        for _, c in links_found:
            state.seen_urls[c.key] = {"url": c.url, "source": c.source_id, "kind": c.kind, "text": c.text, "status": "link_sent" if sent else "link_pending", "first_seen": now}
        print(json.dumps({"links_found": len(links_found), "sent": sent}))
        state.save()

    # Daily Gemini cap, counted in IST days across runs.
    today = datetime.now(IST).date().isoformat()
    used = state.usage.get(today, 0)
    allowed = max(0, int(os.environ.get("GEMINI_DAILY_LIMIT", "40")) - used)
    want_new = min(len(todo), args.max_new, allowed)
    want_backlog = min(args.from_backlog, max(0, allowed - want_new))

    # Backlog: the most likely current notification PDFs first.
    year = today[:4]
    backlog = take_turns(
        [
            Candidate(v["source"], v.get("url", key), v.get("text", ""), v["kind"], key)
            for key, v in state.seen_urls.items()
            if v.get("status") == "backlog" and v.get("kind") != "apply_link" and (not args.sources or v["source"] in args.sources)
            and not looks_outdated(v.get("text", ""), v.get("url", key), today)
        ],
        key=lambda c: read_priority(c, today, from_backlog=True),
    )
    todo.sort(key=lambda c: read_priority(c, today))
    todo = drop_probable_copies(todo, state, now, counts, args.dry_run)
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
    results: list[dict] = []
    failed = _run_parallel(jobs, args.workers, results)
    state.save()
    counts.update(
        gemini_calls=state.usage.get(today, 0) - used,
        drafts_sent=sum(1 for r in results if r.get("ingest")),
        outdated_after_reading=sum(1 for r in results if r.get("outdated")),
        deferred=sum(1 for r in results if r.get("deferred")),
        read_failed=failed,
    )
    errors = [f"{r.get('pdf', '')[:120]}: {r['error'][:200]}" for r in results if r.get("error")]
    if send_run_report(started, site_reports, unsure_found, counts, errors, args.dry_run):
        # Only once the server has them, so an unsent unsure link is offered again next run.
        for _, c in unsure_found:
            state.seen_urls[c.key] = {"url": c.url, "source": c.source_id, "kind": "unsure", "text": c.text, "status": "unsure_sent", "first_seen": now}
        state.save()
    print(json.dumps({"run": counts}))
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
    state.save()
    try:
        result = _process_candidate(c, got, source, args)
    except gemini.GeminiError as e:
        if gemini.is_busy(e):
            # Google was busy: leave the notice unread so the next run tries it again. Not a failure.
            return {"pdf": c.url, "deferred": "Gemini busy, will retry next run"}
        raise
    state.seen_urls[c.key] = {"url": c.url, "source": c.source_id, "kind": c.kind, "text": c.text, "status": "outdated" if result.get("outdated") else "dry_run" if args.dry_run else "sent", "sha256": sha256_hex(got.body), "first_seen": now}
    state.save()  # after every notice, so an interrupted run keeps what it already sent
    return result


def _process_candidate(c: Candidate, got, source: dict, args: argparse.Namespace) -> dict:
    return process_bytes(got.body, c.url, source=source, document_url=got.url, dry_run=args.dry_run, model=args.model, kind=c.kind, insecure_tls=got.insecure_tls)


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


REVISION = re.compile(r"corrigend|addend|amendment|revised|revision|extension|extended|modif", re.I)


def drop_probable_copies(todo: list[Candidate], state: State, now: str, counts: dict, dry_run: bool) -> list[Candidate]:
    """Before any download or AI call: a link whose advertisement number or title matches a document
    we already have is probably the same notice under a new address. Revisions (corrigendum, date
    extension...) are still read, as corrigenda. Probable copies are recorded, never silently lost."""
    url, secret = os.environ.get("INGEST_URL"), os.environ.get("INGEST_HMAC_SECRET")
    if dry_run or not url or not secret or not todo:
        return todo
    by_source: dict[str, list[Candidate]] = {}
    for c in todo:
        if not c.key.startswith("queued:"):
            by_source.setdefault(c.source_id, []).append(c)
    sources = load_sources()
    matches: dict[str, dict] = {}
    for sid, cands in by_source.items():
        try:
            res = post_draft(url.rstrip("/") + "/similar", secret, {
                "source_url": sources[sid]["url"],
                "items": [{"key": c.key, "url": c.url, "text": c.text or c.url} for c in cands[:100]],
            })
            matches.update(res.get("matches", {}))
        except Exception as e:  # check not available (older API): read everything as before
            print(json.dumps({"similar_check_failed": str(e)[:200]}))
            return todo
    kept, copies = [], 0
    for c in todo:
        m = matches.get(c.key)
        if not m:
            kept.append(c)
        elif REVISION.search(c.text or "") or c.kind == "corrigendum":
            c.kind = "corrigendum"
            kept.append(c)
        else:
            copies += 1
            state.seen_urls[c.key] = {"url": c.url, "source": c.source_id, "kind": c.kind, "text": c.text, "status": "probable_copy",
                                      "copy_of": m["document_url"], "reason": m["reason"], "first_seen": now}
            print(json.dumps({"probable_copy": c.url, "of": m["document_url"], "reason": m["reason"]}))
    counts["probable_copies"] = copies
    return kept


def site_report(source: dict, report: dict, new: int) -> dict:
    """One line per official site for the console's Health page."""
    res = str(report.get("result", ""))
    if res.startswith("paused"):
        kind = "paused"
    elif res.startswith("failed"):
        kind = "blocked" if "403" in res else "failed"
    elif res.startswith("robots"):
        kind = "blocked"
    elif res == "unchanged":
        kind = "unchanged"
    elif report.get("note"):
        kind = "js_page"
    else:
        kind = "ok"
    out = {"source_url": source["url"], "result": kind, "new": new}
    if "links" in report:
        out["links"] = report["links"]
    if kind in ("failed", "blocked", "paused"):
        out["error"] = res[:300]
    return out


def take_queued(dry_run: bool) -> list[dict]:
    """Links a reviewer sent from the Unsure list. Taking them marks them as taken on the server."""
    url, secret = os.environ.get("INGEST_URL"), os.environ.get("INGEST_HMAC_SECRET")
    if dry_run or not url or not secret:
        return []
    try:
        return post_draft(url.rstrip("/") + "/queued", secret, {}).get("items", [])
    except Exception as e:
        print(json.dumps({"queued_fetch_failed": str(e)[:200]}))
        return []


def send_run_report(started: str, sites: list[dict], unsure: list, counts: dict, errors: list[str], dry_run: bool) -> bool:
    url, secret = os.environ.get("INGEST_URL"), os.environ.get("INGEST_HMAC_SECRET")
    if dry_run or not url or not secret:
        return False
    body = {
        "started_at": started,
        "finished_at": datetime.now(IST).replace(microsecond=0).isoformat(),
        "host": os.environ.get("COMPUTERNAME") or os.environ.get("HOSTNAME") or "pc",
        "counts": counts,
        "errors": errors[:100],
        "sources": sites[:500],
        "unsure": [{"source_url": s["url"], "url": c.url, "link_text": c.text or c.url} for s, c in unsure][:500],
    }
    try:
        post_draft(url.rstrip("/") + "/run", secret, body)
        return True
    except Exception as e:  # the run itself still counts; the report is only for the console
        print(json.dumps({"run_report_failed": str(e)[:200]}))
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
