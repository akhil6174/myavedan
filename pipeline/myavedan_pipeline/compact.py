"""Shrink notice text before it goes to Gemini, without dropping any facts.

Removes what repeats on most pages (letterheads, "Page 3 of 46", website footers) and collapses
spacing. Page markers stay, so citations still point at the right page. Grounding checks still use
the full original text.
"""

from __future__ import annotations

import re
from collections import Counter

PAGE_NUMBER = re.compile(r"^\s*(page\s*[-:]?\s*\d+(\s*(of|/)\s*\d+)?|\d+\s*(of|/)\s*\d+|-\s*\d+\s*-|\d{1,3})\s*$", re.I)


def _lines(text: str) -> list[str]:
    return [re.sub(r"[ \t ]+", " ", line).strip() for line in text.splitlines()]


def compact_pages(pages: list[tuple[int, str]], repeat_share: float = 0.6) -> list[tuple[int, str]]:
    """Same pages, minus boilerplate that appears on most of them, page numbers and blank runs."""
    split = [(n, _lines(t)) for n, t in pages]
    counts: Counter[str] = Counter()
    for _, lines in split:
        counts.update({line for line in lines if line})
    threshold = max(3, int(len(split) * repeat_share))
    boilerplate = {line for line, c in counts.items() if c >= threshold and len(split) >= 4}

    out = []
    for n, lines in split:
        kept, blank = [], False
        for line in lines:
            if not line:
                if not blank and kept:
                    kept.append("")
                blank = True
                continue
            blank = False
            if line in boilerplate or PAGE_NUMBER.match(line):
                continue
            kept.append(line)
        out.append((n, "\n".join(kept).strip()))
    return out


def saving(before: list[tuple[int, str]], after: list[tuple[int, str]]) -> float:
    a = sum(len(t) for _, t in before)
    b = sum(len(t) for _, t in after)
    return 0.0 if a == 0 else round(1 - b / a, 3)
