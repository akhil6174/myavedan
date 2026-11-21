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
