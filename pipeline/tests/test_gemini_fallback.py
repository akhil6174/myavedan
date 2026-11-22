from myavedan_pipeline import gemini


def test_busy_falls_back_then_flags_lite(monkeypatch):
    calls = []

    def fake(pages, model=None, retries=2):
        calls.append(model)
        if model != gemini.LITE_MODEL:
            raise gemini.GeminiError("Gemini API 503: UNAVAILABLE high demand")
        return {"ok": True}, {"model": model}

    monkeypatch.setattr(gemini, "extract", fake)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    ex, usage = gemini.extract_resilient([(1, "x")])
    assert calls == [gemini.DEFAULT_MODEL, *gemini.FALLBACK_MODELS, gemini.LITE_MODEL]
    assert usage["lite"] and usage["fallback_from"] == gemini.DEFAULT_MODEL


def test_real_errors_do_not_fall_back(monkeypatch):
    def fake(pages, model=None, retries=2):
        raise gemini.GeminiError("Gemini API 400: bad request")

    monkeypatch.setattr(gemini, "extract", fake)
    try:
        gemini.extract_resilient([(1, "x")])
        raise AssertionError("should raise")
    except gemini.GeminiError as e:
        assert not gemini.is_busy(e)


def test_outdated_rules():
    from myavedan_pipeline.cli import outdated_reason
    from myavedan_pipeline.discover import looks_outdated
    today = "2026-11-22"
    assert looks_outdated("Result of Advt 05/2023", "https://x.gov.in/a.pdf", today)
    assert looks_outdated("Notice dated 03.02.2026", "https://x.gov.in/a.pdf", today)
    assert not looks_outdated("Notice dated 12.11.2026", "https://x.gov.in/a.pdf", today)
    assert not looks_outdated("Recruitment notice", "https://x.gov.in/a.pdf", today)
    closed = {"dates": [{"kind": "apply_end", "value": "2026-09-01"}]}
    assert outdated_reason(closed, "notice", today)
    with_exam = {"dates": [{"kind": "apply_end", "value": "2026-09-01"}, {"kind": "exam", "value": "2026-12-10"}]}
    assert outdated_reason(with_exam, "notice", today) is None
    old_result = {"dates": [{"kind": "result", "value": "2026-06-01"}]}
    assert outdated_reason(old_result, "result", today)
    assert outdated_reason({"dates": [{"kind": "exam", "value": "2026-11-07"}]}, "result", today) is None


def test_unsure_links():
    from myavedan_pipeline.discover import classify, is_unsure
    # Not classified, but worth a look
    assert classify("Skill test schedule for Stenographer 2026", "https://x.gov.in/a") is None
    assert is_unsure("Skill test schedule for Stenographer 2026", "https://x.gov.in/a")
    assert is_unsure("Important information", "https://x.gov.in/files/info.pdf")
    # Site menus and tenders: never
    for t in ("Home", "Contact Us", "RTI", "Gallery", "2", "हिन्दी"):
        assert not is_unsure(t, "https://x.gov.in/" + t)
    assert not is_unsure("Tender for printing 2026", "https://x.gov.in/t.pdf")


def test_site_report_kinds():
    from myavedan_pipeline.cli import site_report
    s = {"url": "https://x.gov.in/"}
    assert site_report(s, {"result": "failed: HTTPError: HTTP Error 403: Forbidden"}, 0)["result"] == "blocked"
    assert site_report(s, {"result": "failed: URLError: timed out"}, 0)["result"] == "failed"
    assert site_report(s, {"result": "unchanged"}, 0)["result"] == "unchanged"
    assert site_report(s, {"result": "ok", "links": 2, "note": "very few links"}, 0)["result"] == "js_page"
    assert site_report(s, {"result": "ok", "links": 80}, 3) == {"source_url": "https://x.gov.in/", "result": "ok", "new": 3, "links": 80}
