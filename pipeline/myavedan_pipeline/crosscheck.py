"""A second, rule-based read of the most important facts, independent of Gemini.

Simple patterns look for the last date to apply, the total number of vacancies, age limits and fees.
When the rules find a value and the AI's value is different, the field gets a red flag naming both,
so a person checks the PDF. The rules never change a value, and finding nothing flags nothing.

Also: when every post has a vacancy count, they must add up to the stated total.
"""

from __future__ import annotations

import re
from datetime import date

_NUM = r"(\d{1,3}(?:,\d{2,3})+|\d+)"
_DATE = re.compile(r"(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](20\d\d)(?!\d)")

_LAST_DATE = re.compile(r"(last|closing|end)\s+date|apply\s+(online\s+)?(up\s*to|till|by|before)|अंतिम तिथि|अन्तिम तिथि", re.I)
_TOTAL = [
    re.compile(r"total\s+(?:no\.?\s+of\s+|number\s+of\s+)?(?:posts|vacanc(?:y|ies))\s*[:\-–=]?\s*" + _NUM, re.I),
    re.compile(_NUM + r"\s+(?:posts|vacancies)\s+in\s+total", re.I),
    re.compile(r"कुल\s+(?:पद|रिक्तियां|रिक्तियाँ)[^0-9\n]{0,20}" + _NUM),
]
_AGE = re.compile(r"(?:age|आयु)[^\n]{0,60}?(?<!\d)(1[4-9]|[2-5]\d)\s*(?:to|-|–|and|से)\s*(1[4-9]|[2-5]\d)\s*(?:years|yrs|वर्ष)", re.I)
_FEE = re.compile(r"(?:₹|rs\.?|inr|रु\.?)\s*" + _NUM + r"|" + _NUM + r"\s*/-", re.I)
_FEE_CONTEXT = re.compile(r"fee|शुल्क", re.I)


def _int(s: str) -> int:
    return int(s.replace(",", ""))


def _dates_near_last_date(text: str) -> set[str]:
    found = set()
    for m in _LAST_DATE.finditer(text):
        before = text[max(0, m.start() - 25) : m.start()].lower()
        if re.search(r"(from|after|before|of)\s+(the\s+)?$", before):
            continue  # "one year from the last date ..." refers to something else
        window = text[m.end() : m.end() + 90].split("\n\n")[0]
        for d, mo, y in _DATE.findall(window):
            try:
                found.add(date(int(y), int(mo), int(d)).isoformat())
            except ValueError:
                pass
    return found


def _first_page(pages: dict[int, str], pattern: re.Pattern[str]) -> int | None:
    for n in sorted(pages):
        if pattern.search(pages[n]):
            return n
    return None


def _age_years(born_after: str, as_on: str) -> int | None:
    try:
        a, o = date.fromisoformat(born_after[:10]), date.fromisoformat(as_on[:10])
    except ValueError:
        return None
    years = o.year - a.year - ((o.month, o.day) < (a.month, a.day))
    return years


def crosscheck(draft: dict, pages: dict[int, str]) -> list[dict]:
    flags: list[dict] = []
    text = "\n".join(pages[n] for n in sorted(pages))

    # Last date to apply.
    ai_end = next((d.get("value") for d in draft.get("dates") or [] if d.get("kind") == "apply_end" and d.get("value")), None)
    rule_ends = _dates_near_last_date(text)
    if ai_end and rule_ends and ai_end[:10] not in rule_ends:
        page = _first_page(pages, _LAST_DATE)
        flags.append({"field": "dates", "code": "second_check_last_date", "severity": "error",
                      "message": f"Second check found the last date as {', '.join(sorted(rule_ends))}"
                                 f"{f' (page {page})' if page else ''}; the AI read {ai_end[:10]}. Check the PDF."})

    # Total vacancies, and posts adding up to the total.
    total = draft.get("total_vacancies")
    rule_totals = {_int(m.group(m.lastindex or 1)) for p in _TOTAL for m in p.finditer(text)}
    if isinstance(total, int) and rule_totals and total not in rule_totals:
        flags.append({"field": "total_vacancies", "code": "second_check_vacancies", "severity": "error",
                      "message": f"Second check found the total as {', '.join(map(str, sorted(rule_totals)))}; the AI read {total}. Check the vacancy table."})
    counts = [p.get("vacancies") for p in draft.get("posts") or []]
    if isinstance(total, int) and counts and all(isinstance(c, int) for c in counts) and len(counts) > 1 and sum(counts) != total:
        flags.append({"field": "total_vacancies", "code": "vacancies_dont_add_up", "severity": "error",
                      "message": f"Post-wise vacancies add up to {sum(counts)}, but the total is {total}."})

    # Age limits: only when the notice states one clear range.
    ranges = {(int(a), int(b)) for a, b in _AGE.findall(text) if int(a) < int(b)}
    if len(ranges) == 1:
        lo, hi = next(iter(ranges))
        for i, post in enumerate(draft.get("posts") or []):
            for r in post.get("rules") or []:
                if r.get("kind") != "dob_window" or not r.get("born_on_or_after") or not r.get("as_on"):
                    continue
                ai_max = _age_years(r["born_on_or_after"], r["as_on"])
                if ai_max is not None and abs(ai_max - hi) > 1:
                    flags.append({"field": f"posts.{i}", "code": "second_check_age", "severity": "error",
                                  "message": f"The notice says {lo} to {hi} years; the AI's dates give a maximum age of about {ai_max}. Check the age rule."})

    # Fees: an AI amount that appears nowhere on the pages that talk about fees (alone, or as the sum of
    # two amounts, e.g. exam fee + processing fee).
    amounts: set[int] = set()
    for n in sorted(pages):
        if _FEE_CONTEXT.search(pages[n]):
            for m in _FEE.finditer(pages[n]):
                amounts.add(_int(next(g for g in m.groups() if g)))
    sums = amounts | {a + b for a in amounts for b in amounts}
    for i, fee in enumerate(draft.get("fees") or []):
        amt = fee.get("amount_inr")
        if isinstance(amt, int) and amt > 0 and amounts and amt not in sums:
            flags.append({"field": f"fees.{i}", "code": "second_check_fee", "severity": "error",
                          "message": f"Fee ₹{amt} doesn't appear next to 'fee' in the notice (found: {', '.join(f'₹{a}' for a in sorted(amounts)[:6])})."})
    return flags
