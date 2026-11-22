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
