"""Stage 02-03: find new notices on official recruitment websites, politely.

- Respects robots.txt and waits between requests to the same host.
- Uses ETag / Last-Modified so unchanged listing pages cost almost nothing.
- Keeps only links on the source's official hosts, and only ones that look like recruitment documents.
- Remembers every link it has seen (local state file), so each document is handled once.
- Many government sites have incomplete certificate chains. If strict TLS fails with a certificate
  error, the page is fetched once more without verification and the result is marked, so the reviewer
  knows. Content is never trusted anyway: everything is human-reviewed before publishing.
"""

from __future__ import annotations

import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

USER_AGENT = "MyAvedanReader/0.1 (+https://myavedan.in/about/#sources)"
MAX_PDF_BYTES = 40 * 1024 * 1024
PER_HOST_DELAY_S = 2.0

# What a recruitment document looks like in its link text or URL.
KIND_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("result", re.compile(r"\bresult|marks|merit list|selected candidates|final select", re.I)),
    ("answer_key", re.compile(r"answer[\s_-]*key|tentative key|response sheet", re.I)),
    ("admit_card", re.compile(r"admit[\s_-]*card|e-?admit|call[\s_-]*letter|hall[\s_-]*ticket", re.I)),
    ("cutoff", re.compile(r"cut[\s_-]*off", re.I)),
    ("corrigendum", re.compile(r"corrigend|addend|amendment|extension of (last )?date|date extend|revised", re.I)),
    ("apply_link", re.compile(r"apply online|online application|online registration|new registration|click here to apply|application portal|candidate login|apply now", re.I)),
    ("notice", re.compile(r"recruit|advt|advertisement|notification|vacanc|\bcen\b|employment notice|detailed notice|engagement|applications? (are )?invited|rozgar", re.I)),
]
SKIP = re.compile(
    r"tender|auction|quotation|rti\b|annual report|budget|circular for staff|transfer|posting order|holiday"
    r"|syllabus|caution|fraud|fake|beware",
    re.I,
)


# Links to list pages, not documents.
INDEX_LINK = re.compile(r"\s*(view all|more|read more|click here|archives?|see all)\s*", re.I)


def is_pdf(body: bytes) -> bool:
    """Some government servers send a few blank bytes before the PDF header."""
    return b"%PDF-" in body[:1024]


_TOKEN = re.compile(r"[A-Za-z0-9_-]{20,}")


def link_key(url: str, text: str, source_id: str) -> str:
    """What identifies a document across visits. Most links are stable, but some sites (CISF's
    file_open.php?fnm=...) issue a new random code on every visit: those are known by their title."""
    query = urllib.parse.urlparse(url).query
    if query and any(_TOKEN.fullmatch(v) for _, v in urllib.parse.parse_qsl(query)) and text.strip():
        return f"title:{source_id}:{' '.join(text.lower().split())}"
    return url


_PRIORITY = {"corrigendum": 0, "notice": 1, "result": 2, "admit_card": 2, "answer_key": 2, "cutoff": 2}


def read_priority(c: "Candidate", today: str, from_backlog: bool = False) -> tuple:
    """Order for spending the day's Gemini calls (lower first):
    reviewer-requested links, date changes, recent openings, results/admit cards, other new items,
    then the backlog, newest-looking first."""
    import datetime as _dt

    hay = f"{c.text} {urllib.parse.unquote(c.url)}"
    t = _dt.date.fromisoformat(today)
    dates = []
    for d, m, y in _DMY.findall(hay):
        try:
            dates.append(_dt.date(int(y), int(m), int(d)))
        except ValueError:
            pass
    age = (t - max(dates)).days if dates else 9999
    recent = age <= 30
    kind_rank = _PRIORITY.get(c.kind, 3)
    if c.key.startswith("queued:"):
        group = -1
    elif from_backlog:
        group = 10
    elif c.kind == "corrigendum":
        group = 0
    elif c.kind == "notice" and recent:
        group = 1
    else:
        group = 1 + kind_rank
    return (group, age, -notice_score(c.text, c.url, today[:4]))


def take_turns(cands: list["Candidate"], key) -> list["Candidate"]:
    """Every site gets a turn: the best item of each site first, then each site's second best, and so
    on. Without this, one site whose file names carry dates fills every run."""
    by_site: dict[str, list["Candidate"]] = {}
    for c in sorted(cands, key=key):
        by_site.setdefault(c.source_id, []).append(c)
    queues = sorted(by_site.values(), key=lambda q: key(q[0]))
    out: list["Candidate"] = []
    while queues:
        for q in queues:
            out.append(q.pop(0))
        queues = [q for q in queues if q]
    return out


def notice_score(text: str, url: str, year: str) -> int:
    """How likely a backlog link is a current, readable notification (higher first)."""
    hay = f"{text} {urllib.parse.unquote(url)}".lower()
    score = 0
    if ".pdf" in hay or "file_open" in hay or "attachment" in hay:
        score += 3
    if re.search(r"notification|advertisement|detailed|\bcen\b|employment notice", hay):
        score += 2
    if year in hay:
        score += 2
    if str(int(year) - 1) in hay:
        score += 1
    return score


_YEAR = re.compile(r"(?<!\d)(20[0-3]\d)(?!\d)")
_DMY = re.compile(r"(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](20\d\d)(?!\d)")


def looks_outdated(text: str, url: str, today: str, max_age_days: int = 150) -> bool:
    """Free check before any download or AI call: the link names only years or dates that are long past.
    A link with no year or date is not judged here (the reader checks its dates after reading)."""
    import datetime as _dt

    hay = f"{text} {urllib.parse.unquote(url)}"
    t = _dt.date.fromisoformat(today)
    dates = []
    for d, m, y in _DMY.findall(hay):
        try:
            dates.append(_dt.date(int(y), int(m), int(d)))
        except ValueError:
            pass
    if dates:
        return (t - max(dates)).days > max_age_days
    years = [int(y) for y in _YEAR.findall(hay)]
    return bool(years) and max(years) < t.year - 1


# Site furniture: never a recruitment document.
NAV = re.compile(
    r"^(home|about( us)?|contact( us)?|sitemap|faqs?|login|log in|sign in|register|gallery|photo|video|feedback|help|"
    r"disclaimer|privacy|terms|copyright|accessibility|screen reader|skip to|search|rti|tenders?|news|events?|annual report|"
    r"who'?s who|organi[sz]ation|vision|mission|history|telephone|directory|careers?|back|next|previous|\d+|[a-z]|hindi|english|"
    r"हिन्दी|हिंदी|मुख्य पृष्ठ)$",
    re.I,
)


def is_unsure(text: str, url: str) -> bool:
    """A link the patterns didn't classify but that may still be a document worth a look:
    a PDF, or link text that names a year, an exam or a post. Site menus and tenders are left out."""
    t = " ".join(text.split())
    hay = f"{t} {urllib.parse.unquote(url)}"
    if not t or "{{" in t or NAV.match(t) or SKIP.search(hay) or INDEX_LINK.fullmatch(t):
        return False
    low = hay.lower()
    if ".pdf" in low or "file_open" in low:
        return True
    return len(t) >= 15 and bool(re.search(r"20\d\d|exam|post|vacan|select|candidate|interview|merit|skill test|document verification|dv|walk.?in", t, re.I))


def classify(text: str, url: str) -> str | None:
    """Document kind for a link, or None if it doesn't look like a recruitment document."""
    hay = f"{text} {urllib.parse.unquote(url)}"
    if SKIP.search(hay) or INDEX_LINK.fullmatch(text):
        return None
    for kind, pattern in KIND_PATTERNS:
        if pattern.search(hay):
            return kind
    return None


class _Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            self.links.append((self._href, " ".join(" ".join(self._text).split())))
            self._href = None


def extract_links(html: str, base_url: str) -> list[tuple[str, str]]:
    """(absolute url, link text) for every link, de-duplicated, fragments removed."""
    parser = _Links()
    try:
        parser.feed(html)
    except Exception:  # broken HTML: keep what was parsed
        pass
    seen, out = set(), []
    for href, text in parser.links:
        if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
            continue
        url = urllib.parse.urljoin(base_url, href.strip()).split("#")[0]
        if url not in seen:
            seen.add(url)
            out.append((url, text))
    return out


def host_of(url: str) -> str:
    return (urllib.parse.urlparse(url).hostname or "").lower().removeprefix("www.")


def on_hosts(url: str, hosts: list[str]) -> bool:
    h = host_of(url)
    return any(h == x or h.endswith("." + x) for x in hosts)


@dataclass
class Fetched:
    url: str
    status: int
    body: bytes
    content_type: str
    etag: str | None = None
    last_modified: str | None = None
    insecure_tls: bool = False
    not_modified: bool = False


class Fetcher:
    """Polite HTTP client: robots.txt, per-host delay, conditional GET, size cap."""

    def __init__(self) -> None:
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._last: dict[str, float] = {}

    def _wait(self, host: str) -> None:
        gap = time.time() - self._last.get(host, 0)
        if gap < PER_HOST_DELAY_S:
            time.sleep(PER_HOST_DELAY_S - gap)
        self._last[host] = time.time()

    def allowed(self, url: str) -> bool:
        parts = urllib.parse.urlparse(url)
        root = f"{parts.scheme}://{parts.netloc}"
        if root not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                res = self._open(f"{root}/robots.txt", {}, max_bytes=200_000)
                rp.parse(res.body.decode(errors="replace").splitlines()) if res.status == 200 else rp.parse([])
            except Exception:
                rp.parse([])  # no readable robots.txt: allowed
            self._robots[root] = rp
        rp = self._robots[root]
        return rp is None or rp.can_fetch(USER_AGENT, url)

    def _open(self, url: str, headers: dict, max_bytes: int, insecure: bool = False) -> Fetched:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*", **headers})
        ctx = ssl.create_default_context()
        if insecure:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        try:
            with urllib.request.urlopen(req, timeout=30, context=ctx) as res:  # noqa: S310 - allowlisted official hosts only
                body = res.read(max_bytes + 1)
                if len(body) > max_bytes:
                    raise ValueError(f"larger than {max_bytes // 1_000_000} MB")
                return Fetched(res.geturl(), res.status, body, res.headers.get("Content-Type", ""), res.headers.get("ETag"), res.headers.get("Last-Modified"), insecure)
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return Fetched(url, 304, b"", "", insecure_tls=insecure, not_modified=True)
            raise

    def get(self, url: str, etag: str | None = None, last_modified: str | None = None, max_bytes: int = 5_000_000) -> Fetched:
        self._wait(host_of(url))
        headers = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        try:
            return self._open(url, headers, max_bytes)
        except urllib.error.URLError as e:
            reason = getattr(e, "reason", None)
            if isinstance(reason, ssl.SSLError):  # certificate chain or old TLS settings on the government site
                return self._open(url, headers, max_bytes, insecure=True)
            raise


@dataclass
class State:
    """What the reader has already seen. Lives outside the git checkout so runner clean-ups don't erase it."""

    path: Path
    seen_urls: dict[str, dict] = field(default_factory=dict)
    sources: dict[str, dict] = field(default_factory=dict)
    usage: dict[str, int] = field(default_factory=dict)  # Gemini calls per IST day

    @classmethod
    def load(cls, path: Path) -> "State":
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            usage = {d: n for d, n in sorted(data.get("usage", {}).items())[-30:]}  # keep a month
            return cls(path, data.get("seen_urls", {}), data.get("sources", {}), usage)
        return cls(path)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"seen_urls": self.seen_urls, "sources": self.sources, "usage": self.usage}, indent=1, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)


@dataclass
class Candidate:
    source_id: str
    url: str
    text: str
    kind: str
    key: str = ""  # identity across visits (see link_key); defaults to the URL

    def __post_init__(self) -> None:
        self.key = self.key or self.url


def find_notice_pdf(html: str, base_url: str, hosts: list[str]) -> str | None:
    """A notice link sometimes opens a web page that holds the PDF: pick the PDF on that page."""
    best, best_score = None, 0
    for url, text in extract_links(html, base_url):
        if not on_hosts(url, hosts):
            continue
        low = f"{text} {url}".lower()
        if ".pdf" not in low and "file_open" not in low and "download" not in low:
            continue
        score = 1 + (2 if re.search(r"notification|advertisement|detailed", low) else 0) - (5 if SKIP.search(low) else 0)
        if score > best_score:
            best, best_score = url, score
    return best


def scan_source(fetcher: Fetcher, source: dict, hosts: list[str], state: State) -> tuple[list[Candidate], dict]:
    """Fetch one listing page and return recruitment links not seen before."""
    sid, url = source["id"], source["url"]
    meta = state.sources.get(sid, {})
    report: dict = {"source": sid, "url": url}
    # A site that keeps failing is tried once every 3 days instead of every run.
    if meta.get("failures", 0) >= 4 and time.time() - meta.get("last_attempt", 0) < 3 * 86400:
        report["result"] = f"paused after {meta['failures']} failures (retrying every 3 days)"
        return [], report
    meta["last_attempt"] = time.time()
    state.sources[sid] = meta
    if not fetcher.allowed(url):
        report["result"] = "robots.txt disallows"
        return [], report
    try:
        page = fetcher.get(url, meta.get("etag"), meta.get("last_modified"))
    except Exception as e:  # down, blocked, timeout: try again next run
        report["result"] = f"failed: {type(e).__name__}: {str(e)[:80]}"
        meta["failures"] = meta.get("failures", 0) + 1
        state.sources[sid] = meta
        return [], report
    meta.update(failures=0, checked_at=time.strftime("%Y-%m-%dT%H:%M:%S"))
    if page.not_modified:
        report["result"] = "unchanged"
        state.sources[sid] = meta
        return [], report
    meta.update(etag=page.etag, last_modified=page.last_modified)
    state.sources[sid] = meta

    html = page.body.decode("utf-8", errors="replace")
    links = extract_links(html, page.url)
    found: list[Candidate] = []
    unsure: list[Candidate] = []
    for link, text in links:
        if not on_hosts(link, hosts):
            continue
        kind = classify(text, link)
        key = link_key(link, text, sid)
        pending = state.seen_urls.get(key, {}).get("status") == "link_pending"
        if kind and (key not in state.seen_urls or pending):
            found.append(Candidate(sid, link, text[:200], kind, key))
        elif not kind and key not in state.seen_urls and is_unsure(text, link):
            unsure.append(Candidate(sid, link, text[:200], "unsure", key))
    report.update(result="ok", links=len(links), recruitment_links=len(found), insecure_tls=page.insecure_tls)
    report["_unsure"] = unsure[:40]
    if len(links) < 5:
        report["note"] = "very few links: the page may be built by JavaScript and need a custom reader"
    return found, report
