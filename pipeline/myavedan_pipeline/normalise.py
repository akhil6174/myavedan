"""Tables found on a page are added to that page as Markdown tables, so a vacancy row stays one row
instead of being scattered across lines. The same text is used for the fact check, so quotes taken
from a table still match the page they cite.
"""

from __future__ import annotations


def table_markdown(rows: list[list[str]]) -> str:
    """A table as Markdown. Cells keep their text on one line; empty rows are dropped."""
    clean = [[" ".join(str(c or "").split()).replace("|", "/") for c in row] for row in rows]
    clean = [r for r in clean if any(r)]
    if len(clean) < 2 or max(len(r) for r in clean) < 2:
        return ""
    width = max(len(r) for r in clean)
    clean = [r + [""] * (width - len(r)) for r in clean]
    lines = ["| " + " | ".join(clean[0]) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(r) + " |" for r in clean[1:]]
    return "\n".join(lines)


def page_text(text: str, tables: list[list[list[str]]]) -> str:
    """The page's text, then each table on it in Markdown."""
    parts = [text.rstrip()]
    for t in tables:
        md = table_markdown(t)
        if md:
            parts.append(f"[table]\n{md}\n[/table]")
    return "\n\n".join(p for p in parts if p)
