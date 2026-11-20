"""Turn a Gemini extraction into a draft in the site's snapshot format, with grounding results and flags.

Deterministic: no network, no AI. Tested in tests/test_convert.py.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from .grounding import check_field
from .validate import validate_draft

QUAL_ORDER = ["10th", "12th", "iti", "diploma", "graduate", "postgraduate", "doctorate"]


def _iso(value: str | None) -> str | None:
    if value and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        try:
            date.fromisoformat(value)
            return value
        except ValueError:
            return None
    return None


def _same_day_years_earlier(d: date, years: int) -> date:
    """The birth date that reaches exactly `years` on d. Someone born 28 Feb has had their birthday by 29 Feb."""
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # 29 Feb in a non-leap year
        return d.replace(year=d.year - years, day=28)


def dob_window(age: dict) -> tuple[str, str] | None:
    """Birth-date window from an age rule. A stated window wins; otherwise derive from ages and the cut-off date.

    Aged at least MIN on AS_ON  -> born on or before AS_ON - MIN years.
    Aged at most MAX on AS_ON   -> born on or after (AS_ON - (MAX + 1) years) + 1 day.
    """
    after, before = _iso(age.get("born_on_or_after")), _iso(age.get("born_on_or_before"))
    if after and before:
        return after, before
    as_on = _iso(age.get("as_on"))
    lo, hi = age.get("min_age", -1), age.get("max_age", -1)
    if not as_on or lo is None or hi is None or lo < 0 or hi < 0:
        return None
    cut = date.fromisoformat(as_on)
    before_d = _same_day_years_earlier(cut, lo)
    after_d = _same_day_years_earlier(cut, hi + 1) + timedelta(days=1)
    return after_d.isoformat(), before_d.isoformat()


def slugify(*parts: str) -> str:
    text = " ".join(p for p in parts if p).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return re.sub(r"-{2,}", "-", text)[:90].strip("-") or "notice"


def _evidence(item: dict) -> dict | None:
    page, snippet = item.get("page"), (item.get("snippet") or "").strip()
    if not isinstance(page, int) or page < 1 or not snippet:
        return None
    ev = {"page": page, "snippet": snippet[:300]}
    if (item.get("section") or "").strip():
        ev["section"] = item["section"].strip()[:40]
    return ev


def _date_value(d: dict) -> str | None:
    day = _iso(d.get("date"))
    if not day:
        return None
    t = (d.get("time") or "").strip()
    if re.fullmatch(r"\d{1,2}:\d{2}", t):
        h, m = t.split(":")
        if int(h) < 24 and int(m) < 60:
            return f"{day}T{int(h):02d}:{m}:00+05:30"
    return day


def to_draft(ex: dict, *, organization: dict, notice_url: str, official_page: str, today: str) -> dict:
    """Build an opportunity-shaped draft. `organization` is the registered organisation (name, jurisdiction, state, domain)."""
    year = today[:4]
    title = (ex.get("title") or "Untitled notice").strip()
    slug = slugify(organization.get("short") or "", title if year in title else f"{title} {year}")
    host = organization["domain"]

    dates = []
    for d in ex.get("dates", []):
        value = _date_value(d)
        item = {"kind": d["kind"], "value": value, "tentative": bool(d.get("tentative")), "evidence": _evidence(d)}
        if not value and (d.get("approx") or "").strip():
            item["approx"] = d["approx"].strip()
        if value or item.get("approx"):
            dates.append(item)
    if not any(d["kind"] == "notification" for d in dates):
        dates.insert(0, {"kind": "notification", "value": None, "approx": "Not stated", "tentative": False, "evidence": None})

    posts, levels = [], set()
    used_ids: set[str] = set()
    for p in ex.get("posts", []):
        pid = slugify(p.get("name", "post")) or "post"
        while pid in used_ids:
            pid += "-2"
        used_ids.add(pid)
        rules: list[dict] = []
        age = p.get("age")
        if age:
            window = dob_window(age)
            ev = _evidence(age)
            if window and ev:
                rules.append({
                    "kind": "dob_window",
                    "born_on_or_after": window[0],
                    "born_on_or_before": window[1],
                    **({"as_on": _iso(age.get("as_on"))} if _iso(age.get("as_on")) else {}),
                    "stated": (age.get("stated") or "").strip() or f"{age.get('min_age')}–{age.get('max_age')} years",
                    "relaxations": [
                        {
                            "applies_to": r["group"],
                            "years": None if (r.get("years") is None or r["years"] < 0) else r["years"],
                            "cumulative": bool(r.get("cumulative")),
                            "evidence": _evidence(r),
                        }
                        for r in age.get("relaxations", [])
                    ],
                    "evidence": ev,
                })
        q = p.get("qualification")
        if q and _evidence(q) and q.get("min_level") in QUAL_ORDER:
            levels.add(q["min_level"])
            fy = {"yes": True, "no": False}.get(q.get("final_year_allowed"), None)
            rules.append({
                "kind": "qualification",
                "min_level": q["min_level"],
                "held_by": _iso(q.get("held_by")),
                "final_year_allowed": fy,
                "subjects": [s for s in q.get("subjects", []) if s][:10],
                "stated": (q.get("stated") or "").strip() or q["min_level"],
                "evidence": _evidence(q),
            })
        for c in p.get("other_conditions", []):
            ev = _evidence(c)
            if ev and (c.get("label") or "").strip():
                rules.append({"kind": "other", "label": c["label"].strip()[:60], "stated": (c.get("stated") or c["label"]).strip(), "blocking": bool(c.get("blocking")), "evidence": ev})
        vac = p.get("vacancies")
        posts.append({
            "id": pid,
            "name": (p.get("name") or "Post").strip(),
            "vacancies": vac if isinstance(vac, int) and vac >= 0 else None,
            **({"location": p["location"].strip()} if (p.get("location") or "").strip() else {}),
            **({"pay": p["pay"].strip()} if (p.get("pay") or "").strip() else {}),
            "rules": rules,
            "evidence": _evidence(p),
        })

    total = ex.get("total_vacancies")
    apply_url = (ex.get("apply_url") or "").strip() or None
    jurisdiction = organization["jurisdiction"]
    locations = sorted({p["location"] for p in posts if p.get("location")}) or (["All India"] if jurisdiction == "central" else [organization.get("state") or "India"])

    return {
        "id": f"opp_{slug.replace('-', '_')}"[:100],
        "slug": slug,
        "type": "job",
        "title": title,
        "organization": {k: organization[k] for k in ("name", "jurisdiction", "state", "domain") if k in organization} | ({"short": organization["short"]} if organization.get("short") else {}),
        "advt_no": (ex.get("advt_no") or "").strip() or None,
        "qualification_levels": sorted(levels, key=QUAL_ORDER.index) or ["graduate"],
        "locations": locations,
        "total_vacancies": total if isinstance(total, int) and total >= 0 else None,
        "summary": {"en": (ex.get("summary_en") or "").strip() or title, "reviewed": False},
        "dates": dates,
        "posts": posts or [{"id": "post", "name": title, "vacancies": None, "rules": [], "evidence": None}],
        "fees": [
            {"applies_to": (f.get("applies_to") or "All").strip(), "amount_inr": f["amount_inr"], "evidence": _evidence(f)}
            for f in ex.get("fees", [])
            if isinstance(f.get("amount_inr"), (int, float)) and f["amount_inr"] >= 0
        ],
        "selection_stages": [s for s in ex.get("selection_stages", []) if s][:15],
        "documents_required": [s for s in ex.get("documents_required", []) if s][:30],
        "events": [],
        "links": {"notice_pdf": notice_url, "official_page": official_page, "apply": apply_url},
        "_host": host,
    }


def _walk_evidence(draft: dict):
    """(field key, value, evidence) for every cited field, keyed like the review console."""
    for i, d in enumerate(draft["dates"]):
        yield f"dates.{i}", d.get("value"), d.get("evidence")
    for i, p in enumerate(draft["posts"]):
        yield f"posts.{i}", p.get("vacancies"), p.get("evidence")
        for j, r in enumerate(p["rules"]):
            yield f"posts.{i}.rules.{j}", None, r.get("evidence")
    for i, f in enumerate(draft["fees"]):
        yield f"fees.{i}", f.get("amount_inr"), f.get("evidence")


def ground_and_flag(draft: dict, pages: dict[int, str], official_hosts: list[str], unread_pages: list[int]) -> tuple[dict, list[dict]]:
    grounding: dict[str, dict] = {}
    for key, value, ev in _walk_evidence(draft):
        if not ev:
            continue
        page = pages.get(ev["page"], "")
        result = check_field(value, page, ev["snippet"]) if page else {"grounded": False, "snippet_found": False}
        grounding[key] = {"grounded": bool(result["grounded"]), "score": result.get("snippet_score", 0)}

    flags = validate_draft(draft, official_hosts)
    for key, g in grounding.items():
        if not g["grounded"]:
            flags.append({"field": key, "code": "ungrounded", "severity": "warning", "message": "The cited quote or value was not found on that page"})
    if unread_pages:
        flags.append({"field": "summary", "code": "unread_pages", "severity": "warning",
                      "message": f"Pages without readable text (scanned, OCR unavailable): {', '.join(map(str, unread_pages[:20]))}. Check them in the PDF."})
    if not any(d["kind"] == "apply_end" and d.get("value") for d in draft["dates"]):
        flags.append({"field": "dates", "code": "no_deadline", "severity": "warning", "message": "No application deadline was extracted"})
    for i, p in enumerate(draft["posts"]):
        if not any(r["kind"] == "dob_window" for r in p["rules"]):
            flags.append({"field": f"posts.{i}", "code": "no_age_rule", "severity": "warning", "message": f"No age rule extracted for {p['name']}"})
    draft = {k: v for k, v in draft.items() if not k.startswith("_")}
    draft["grounding"] = grounding
    return draft, flags
