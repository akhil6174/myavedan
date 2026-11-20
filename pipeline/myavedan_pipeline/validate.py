"""Stage 09: deterministic validation of an extraction draft.

The draft uses the same shape as a snapshot opportunity (packages/schema/src/types.ts).
Each problem becomes a flag the reviewer sees; "error" flags mark the version validation_failed.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

CRITICAL_DATE_KINDS = {"apply_start", "apply_end", "correction_start", "correction_end", "exam"}
MIN_PLAUSIBLE_AGE = 14
MAX_PLAUSIBLE_AGE = 67


def _flag(field: str, code: str, message: str, severity: str = "error") -> dict[str, str]:
    return {"field": field, "code": code, "severity": severity, "message": message}


def _date_value(draft: dict[str, Any], kind: str) -> str | None:
    for d in draft.get("dates", []):
        if d.get("kind") == kind and d.get("value"):
            return str(d["value"])
    return None


def _host_ok(url: str, hosts: list[str]) -> bool:
    host = (urlparse(url).hostname or "").removeprefix("www.")
    return any(host == h or host.endswith("." + h) for h in hosts)


def _years_between(earlier: str, later: str) -> float:
    ey, em, ed = (int(x) for x in earlier[:10].split("-"))
    ly, lm, ld = (int(x) for x in later[:10].split("-"))
    return (ly - ey) + (lm - em) / 12 + (ld - ed) / 365


def validate_draft(draft: dict[str, Any], official_hosts: list[str]) -> list[dict[str, str]]:
    flags: list[dict[str, str]] = []

    # Critical dates need evidence.
    for i, d in enumerate(draft.get("dates", [])):
        if d.get("value") and d.get("kind") in CRITICAL_DATE_KINDS and not d.get("evidence"):
            flags.append(_flag(f"dates.{i}", "missing_evidence", f"{d.get('kind')} has a value but no evidence"))

    # Date order.
    start, end, exam = _date_value(draft, "apply_start"), _date_value(draft, "apply_end"), _date_value(draft, "exam")
    if start and end and start[:10] > end[:10]:
        flags.append(_flag("dates", "date_order", f"apply_start {start} is after apply_end {end}"))
    if end and exam and exam[:10] < end[:10]:
        flags.append(_flag("dates", "date_order", f"exam {exam} is before apply_end {end}"))

    # Posts, vacancies and rules.
    posts = draft.get("posts", [])
    seen: set[str] = set()
    for i, p in enumerate(posts):
        pid = p.get("id", "")
        if pid in seen:
            flags.append(_flag(f"posts.{i}.id", "duplicate_post", f"duplicate post id {pid}"))
        seen.add(pid)
        for j, r in enumerate(p.get("rules", [])):
            if r.get("kind") != "dob_window":
                continue
            after, before, as_on = r.get("born_on_or_after"), r.get("born_on_or_before"), r.get("as_on")
            if after and before and after > before:
                flags.append(_flag(f"posts.{i}.rules.{j}", "dob_window_order", "born_on_or_after is later than born_on_or_before"))
            if as_on and after and before:
                youngest = _years_between(before, as_on)
                oldest = _years_between(after, as_on) - 1 / 365  # the window ends the day before the next birthday
                no_minimum = before >= as_on  # notice states only a maximum age
                no_maximum = after <= "1900-01-01"  # notice states only a minimum age
                if (not no_minimum and youngest < MIN_PLAUSIBLE_AGE) or (not no_maximum and oldest > MAX_PLAUSIBLE_AGE):
                    flags.append(
                        _flag(f"posts.{i}.rules.{j}", "implausible_age", f"age window works out to {youngest:.0f}–{oldest:.0f} years", "warning")
                    )

    total = draft.get("total_vacancies")
    counts = [p.get("vacancies") for p in posts]
    if total is not None and counts and all(isinstance(c, int) for c in counts) and sum(counts) != total:
        flags.append(_flag("total_vacancies", "vacancy_sum", f"posts add up to {sum(counts)}, total says {total}"))

    for i, f in enumerate(draft.get("fees", [])):
        amount = f.get("amount_inr")
        if not isinstance(amount, (int, float)) or amount < 0:
            flags.append(_flag(f"fees.{i}", "fee_value", f"fee {amount!r} is not a non-negative number"))

    # Links stay on official hosts.
    for key, url in (draft.get("links") or {}).items():
        if url and not _host_ok(url, official_hosts):
            flags.append(_flag(f"links.{key}", "off_host_link", f"{url} is not on an official host"))

    return flags
