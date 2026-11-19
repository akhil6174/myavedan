import json
from pathlib import Path

from myavedan_pipeline.ingest_client import sign
from myavedan_pipeline.sections import coverage_report, section_map
from myavedan_pipeline.validate import validate_draft

ROOT = Path(__file__).resolve().parents[2]
SAMPLE = json.loads((ROOT / "data" / "snapshot.json").read_text(encoding="utf-8"))["opportunities"][0]


def codes(flags):
    return {f["code"] for f in flags}


def test_sample_record_passes_validation():
    assert validate_draft(SAMPLE, ["example.org"]) == []


def test_date_order_is_checked():
    draft = json.loads(json.dumps(SAMPLE))
    next(d for d in draft["dates"] if d["kind"] == "apply_start")["value"] = "2026-12-31"
    assert "date_order" in codes(validate_draft(draft, ["example.org"]))


def test_vacancy_sum_is_checked():
    draft = json.loads(json.dumps(SAMPLE))
    draft["total_vacancies"] = 1300
    assert "vacancy_sum" in codes(validate_draft(draft, ["example.org"]))


def test_links_must_stay_on_official_hosts():
    draft = json.loads(json.dumps(SAMPLE))
    draft["links"]["apply"] = "https://example-org-apply.com/"
    assert "off_host_link" in codes(validate_draft(draft, ["example.org"]))


def test_critical_dates_need_evidence():
    draft = json.loads(json.dumps(SAMPLE))
    next(d for d in draft["dates"] if d["kind"] == "apply_end")["evidence"] = None
    assert "missing_evidence" in codes(validate_draft(draft, ["example.org"]))


def test_implausible_age_window_is_a_warning():
    draft = json.loads(json.dumps(SAMPLE))
    draft["posts"][0]["rules"][0]["born_on_or_before"] = "2020-01-01"
    flags = validate_draft(draft, ["example.org"])
    assert any(f["code"] == "implausible_age" and f["severity"] == "warning" for f in flags)


def test_section_map_labels_english_and_hindi_pages():
    pages = [
        "IMPORTANT DATES  Last date: 15.12.2026",
        "आयु सीमा: 18 से 27 वर्ष",
        "Application fee: Rs 100",
        "Number of posts and vacancy distribution",
        "General instructions for candidates",
    ]
    mapping = section_map(pages)
    assert "dates" in mapping[1]
    assert "eligibility" in mapping[2]
    assert "fees" in mapping[3]
    assert "posts" in mapping[4]
    assert mapping[5] == ["unlabelled"]
    report = coverage_report(mapping)
    assert report["unlabelled_pages"] == [5]
    assert report["missing_sections"] == []


def test_signature_matches_the_worker():
    # RFC 4231 test case 2, the same vector the Worker tests use.
    import hashlib
    import hmac

    assert hmac.new(b"Jefe", b"what do ya want for nothing?", hashlib.sha256).hexdigest() == (
        "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
    )
    assert sign("s", "{}", 1) == hmac.new(b"s", b"1.{}", hashlib.sha256).hexdigest()
