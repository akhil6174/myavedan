"""Stage 06: label every page so we can prove the whole notice was covered.

Keyword rules first (English and Hindi). Only pages these rules cannot label are sent to a
short AI call in M3. Nothing is skipped silently: unlabelled pages are reported for review.
"""

from __future__ import annotations

import re

SECTION_KEYWORDS: dict[str, list[str]] = {
    "dates": ["important dates", "last date", "closing date", "schedule", "महत्वपूर्ण तिथि", "अंतिम तिथि"],
    "posts": ["vacancy", "vacancies", "number of posts", "name of the post", "रिक्ति", "पदों"],
    "eligibility": ["eligibility", "age limit", "educational qualification", "age relaxation", "आयु सीमा", "शैक्षणिक योग्यता", "योग्यता"],
    "fees": ["application fee", "examination fee", "fee payable", "आवेदन शुल्क", "शुल्क"],
    "selection": ["selection process", "scheme of examination", "mode of selection", "चयन प्रक्रिया"],
    "documents": ["documents required", "certificate", "upload", "प्रमाण पत्र", "दस्तावेज"],
    "annexure": ["annexure", "appendix", "परिशिष्ट"],
}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).lower()


def label_page(text: str) -> list[str]:
    t = _norm(text)
    return [section for section, words in SECTION_KEYWORDS.items() if any(w in t for w in words)]


def section_map(pages: list[str]) -> dict[int, list[str]]:
    """Map 1-based page numbers to section labels. Pages with no label get ["unlabelled"]."""
    return {i + 1: (label_page(text) or ["unlabelled"]) for i, text in enumerate(pages)}


def coverage_report(mapping: dict[int, list[str]]) -> dict[str, object]:
    found = {s for labels in mapping.values() for s in labels}
    required = {"dates", "posts", "eligibility", "fees"}
    return {
        "pages": len(mapping),
        "unlabelled_pages": [p for p, labels in mapping.items() if labels == ["unlabelled"]],
        "missing_sections": sorted(required - found),
    }
