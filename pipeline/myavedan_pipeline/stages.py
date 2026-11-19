"""Pipeline stages that touch the network, files or AI.

Parsing is implemented (PyMuPDF and Tesseract are imported lazily, so tests don't need them).
Discovery, fetching, classification and AI extraction are M3 work; each stub states its contract.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

MIN_TEXT_CHARS = 40  # below this, a page is treated as scanned and sent to OCR


@dataclass
class Source:
    id: str
    organization_id: str
    url: str
    kind: str  # rss | html_list | pdf_index | manual
    official_hosts: list[str]
    reason: str
    cadence_minutes: int = 180
    tier: int = 2


@dataclass
class Page:
    number: int
    text: str
    ocr: bool = False
    tables: list[list[list[str]]] = field(default_factory=list)


def load_sources(path: str | Path) -> list[Source]:
    """Stage 01. The real registry lives in D1; this file is for local runs and the golden set."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return [Source(**s) for s in data["sources"]]


def discover(source: Source) -> list[str]:
    """Stage 02 (M3). Conditional GET of the listing page (ETag / If-Modified-Since), obey robots.txt,
    wait between requests to the same host, return absolute URLs of notice documents on official hosts.
    Never bypass logins or CAPTCHAs."""
    raise NotImplementedError("discover() arrives in M3")


def fetch(url: str) -> bytes:
    """Stage 03 (M3). Download with a size cap and timeout; caller fingerprints and stores in R2."""
    raise NotImplementedError("fetch() arrives in M3")


def classify_and_link(pages: list[Page], advt_no_hint: str | None) -> dict[str, object]:
    """Stage 04 (M3). Decide document kind and the opportunity it belongs to:
    advertisement number first, then organisation + title similarity; unsure → reviewer."""
    raise NotImplementedError("classify_and_link() arrives in M3")


def parse_pdf(data: bytes, ocr_languages: str = "hin+eng") -> list[Page]:
    """Stage 05. Text and tables for every page. Pages without a usable text layer go to OCR."""
    import fitz  # PyMuPDF

    pages: list[Page] = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        for index, page in enumerate(doc):
            text = page.get_text("text")
            tables: list[list[list[str]]] = []
            try:
                for table in page.find_tables().tables:
                    tables.append([[cell or "" for cell in row] for row in table.extract()])
            except Exception:  # table detection is best-effort
                tables = []
            if len(text.strip()) >= MIN_TEXT_CHARS:
                pages.append(Page(number=index + 1, text=text, tables=tables))
            else:
                pages.append(Page(number=index + 1, text=_ocr_page(page, ocr_languages), ocr=True, tables=tables))
    return pages


def _ocr_page(page: object, languages: str) -> str:
    import pytesseract
    from PIL import Image

    pix = page.get_pixmap(dpi=300)  # type: ignore[attr-defined]
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return pytesseract.image_to_string(image, lang=languages)


def extract(pages: list[Page], section_map: dict[int, list[str]]) -> dict[str, object]:
    """Stage 07 (M3). One Gemini call per section group with a JSON response schema generated from
    packages/schema. Notice text is fenced and labelled as untrusted data. Every critical field returns
    value, page, section and snippet. Only public notice text is ever sent."""
    raise NotImplementedError("extract() arrives in M3")
