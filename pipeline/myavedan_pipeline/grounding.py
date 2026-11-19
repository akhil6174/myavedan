"""Stage 08: grounding check.

An extracted field is "grounded" only if
  1. its snippet can be found (allowing small OCR differences) on the page it cites, and
  2. its value can be read from that snippet (dates, numbers and rupee amounts normalised).
Ungrounded fields are highlighted for the reviewer. This is deterministic: no AI.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from difflib import SequenceMatcher

DASHES = re.compile(r"[‐-―−]")
MONTHS = {
    m: i + 1
    for i, names in enumerate(
        [
            ("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"), ("may",), ("jun", "june"),
            ("jul", "july"), ("aug", "august"), ("sep", "sept", "september"), ("oct", "october"), ("nov", "november"), ("dec", "december"),
        ]
    )
    for m in names
}


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = DASHES.sub("-", text)
    return re.sub(r"\s+", " ", text).strip()


def _fuzzy_contains(page: str, snippet: str, threshold: float) -> float:
    n = len(snippet)
    if n == 0 or not page:
        return 0.0
    if len(page) <= n:
        return SequenceMatcher(None, snippet, page).ratio()
    best = 0.0
    step = max(1, n // 10)
    for i in range(0, len(page) - n + 1, step):
        r = SequenceMatcher(None, snippet, page[i : i + n]).ratio()
        if r > best:
            best = r
            if best >= 0.999:
                break
    return best


def find_snippet(page_text: str, snippet: str, threshold: float = 0.88) -> tuple[bool, float]:
    """True when the snippet appears on the page. "..." in a snippet marks omitted text: each part must appear in order."""
    page = normalise(page_text)
    snip = normalise(snippet)
    if not snip:
        return False, 0.0
    parts = [p.strip() for p in re.split(r"\.{3}|…", snip) if p.strip()]
    if len(parts) > 1:
        pos, scores = 0, []
        for part in parts:
            idx = page.find(part, pos)
            if idx >= 0:
                scores.append(1.0)
                pos = idx + len(part)
            else:
                scores.append(_fuzzy_contains(page[pos:], part, threshold))
        score = min(scores)
        return score >= threshold, score
    if snip in page:
        return True, 1.0
    score = _fuzzy_contains(page, snip, threshold)
    return score >= threshold, score


_NUMERIC_DATE = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b")
_DAY_MONTH_YEAR = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b")
_MONTH_DAY_YEAR = re.compile(r"\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b")


def _safe_date(y: int, m: int, d: int) -> str | None:
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def dates_in(text: str) -> set[str]:
    """ISO dates written in a snippet. Indian notices use day-first numeric dates."""
    t = normalise(text)
    found: set[str] = set()
    for d, m, y in _NUMERIC_DATE.findall(t):
        iso = _safe_date(int(y), int(m), int(d))
        if iso:
            found.add(iso)
    for d, mon, y in _DAY_MONTH_YEAR.findall(t):
        if mon in MONTHS:
            iso = _safe_date(int(y), MONTHS[mon], int(d))
            if iso:
                found.add(iso)
    for mon, d, y in _MONTH_DAY_YEAR.findall(t):
        if mon in MONTHS:
            iso = _safe_date(int(y), MONTHS[mon], int(d))
            if iso:
                found.add(iso)
    return found


def numbers_in(text: str) -> set[float]:
    """Numbers in a snippet, accepting Indian grouping (1,00,000) and rupee signs."""
    found: set[float] = set()
    for raw in re.findall(r"\d[\d,]*(?:\.\d+)?", normalise(text)):
        try:
            found.add(float(raw.replace(",", "")))
        except ValueError:
            continue
    return found


def value_supported(value: object, snippet: str) -> bool:
    if value is None:
        return True
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return float(value) in numbers_in(snippet)
    if isinstance(value, str):
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}(T.*)?", value):
            return value[:10] in dates_in(snippet)
        return normalise(value) in normalise(snippet) or find_snippet(snippet, value, 0.85)[0]
    return False


def check_field(value: object, page_text: str, snippet: str) -> dict[str, object]:
    found, score = find_snippet(page_text, snippet)
    supported = value_supported(value, snippet)
    return {"grounded": bool(found and supported), "snippet_found": found, "snippet_score": round(score, 3), "value_in_snippet": supported}
