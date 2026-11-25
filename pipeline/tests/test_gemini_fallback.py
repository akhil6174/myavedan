from myavedan_pipeline import gemini


def test_busy_falls_back_then_flags_lite(monkeypatch):
    calls = []

    def fake(pages, model=None, retries=2, **kw):
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
    def fake(pages, model=None, retries=2, **kw):
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
    assert looks_outdated("Counseling notice Advt 08 of 2025", "https://x.gov.in/a.pdf", today)
    assert looks_outdated("Notice dated 03.02.2026", "https://x.gov.in/a.pdf", today)
    assert not looks_outdated("Notice dated 12.11.2026", "https://x.gov.in/a.pdf", today)
    assert not looks_outdated("Recruitment notice", "https://x.gov.in/a.pdf", today)
    closed = {"dates": [{"kind": "apply_end", "value": "2026-09-01"}]}
    assert outdated_reason(closed, "notice", today)
    with_exam = {"dates": [{"kind": "apply_end", "value": "2026-09-01"}, {"kind": "exam", "value": "2026-12-10"}]}
    assert outdated_reason(with_exam, "notice", today)  # owner: closed deadline is never listed
    assert outdated_reason({"title": "Group D Recruitment 2025 (Counseling)", "advt_no": "08/2025", "dates": []}, "result", today)
    assert outdated_reason({"title": "PST schedule", "advt_no": "13/2024, 02/2026", "dates": []}, "result", today) is None
    assert outdated_reason({"title": "Clerk 2026", "dates": [{"kind": "apply_end", "value": "2026-12-15"}]}, "notice", today) is None
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


def test_read_priority():
    from myavedan_pipeline.discover import Candidate, read_priority
    t = "2026-11-22"
    c = lambda kind, text, key="": Candidate("s", f"https://x.gov.in/{text}", text, kind, key)
    items = [
        c("notice", "Recruitment notice 2024 old"),
        c("result", "Result of exam"),
        c("notice", "Advertisement dated 15.11.2026"),
        c("corrigendum", "Date extension"),
        c("notice", "Reviewer asked", key="queued:x"),
    ]
    order = [x.text for x in sorted(items, key=lambda x: read_priority(x, t))]
    assert order[:3] == ["Reviewer asked", "Date extension", "Advertisement dated 15.11.2026"]
    assert read_priority(items[1], t) < read_priority(items[1], t, from_backlog=True)


def test_probable_copies(monkeypatch, tmp_path):
    from myavedan_pipeline import cli
    from myavedan_pipeline.discover import Candidate, State
    monkeypatch.setenv("INGEST_URL", "https://api.test/api/ingest")
    monkeypatch.setenv("INGEST_HMAC_SECRET", "s")
    monkeypatch.setattr(cli, "load_sources", lambda: {"s": {"id": "s", "url": "https://x.gov.in/"}})
    monkeypatch.setattr(cli, "post_draft", lambda url, secret, body: {"matches": {
        "a": {"document_url": "https://x.gov.in/old.pdf", "kind": "notice", "reason": "same advertisement number 5/2026"},
        "b": {"document_url": "https://x.gov.in/old.pdf", "kind": "notice", "reason": "same advertisement number 5/2026"},
    }})
    todo = [Candidate("s", "https://x.gov.in/a.pdf", "Advt 5/2026 notice", "notice", "a"),
            Candidate("s", "https://x.gov.in/b.pdf", "Advt 5/2026 date extension", "notice", "b"),
            Candidate("s", "https://x.gov.in/c.pdf", "Other notice", "notice", "c")]
    state, counts = State(tmp_path / "st.json"), {}
    kept = cli.drop_probable_copies(todo, state, "2026-11-22T10:00:00", counts, dry_run=False)
    assert [c.key for c in kept] == ["b", "c"] and kept[0].kind == "corrigendum"
    assert state.seen_urls["a"]["status"] == "probable_copy" and counts["probable_copies"] == 1


def test_backlog_takes_turns():
    from myavedan_pipeline.discover import Candidate, read_priority, take_turns
    t = "2026-11-22"
    c = [Candidate("psssb", f"https://p/{i}-15.11.2026.pdf", f"Notice 15.11.2026 #{i}", "notice", f"p{i}") for i in range(5)]
    c += [Candidate("rpsc", "https://r/a.pdf", "Advertisement", "notice", "r1"), Candidate("ppsc", "https://q/a.pdf", "Result", "result", "q1")]
    order = [x.source_id for x in take_turns(c, key=lambda x: read_priority(x, t, from_backlog=True))]
    assert set(order[:3]) == {"psssb", "rpsc", "ppsc"}  # every site before any site's second item
    assert order.count("psssb") == 5


def test_row_context_for_generic_links():
    from myavedan_pipeline.discover import extract_links
    html = """<table>
      <tr><td>Cut-off marks for Post Code 42/25</td><td>18-11-2026</td><td><a href="/a.pdf">Download</a></td></tr>
      <tr><td>Advertisement No. 06/2026 Junior Engineer</td><td><a href="/b.pdf">Advertisement No. 06/2026 Junior Engineer</a></td><td>04.11.2026</td></tr>
    </table><ul><li><a href="/c.pdf"></a> Result of Skill Test 20.11.2026</li></ul><a href="/menu">Home</a>"""
    got = dict(extract_links(html, "https://x.gov.in/"))
    assert "Cut-off marks for Post Code 42/25" in got["https://x.gov.in/a.pdf"] and "18-11-2026" in got["https://x.gov.in/a.pdf"]
    assert got["https://x.gov.in/b.pdf"] == "Advertisement No. 06/2026 Junior Engineer (04.11.2026)"
    assert "Result of Skill Test" in got["https://x.gov.in/c.pdf"]
    assert got["https://x.gov.in/menu"] == "Home"


def test_looks_recent():
    from myavedan_pipeline.discover import looks_recent
    t = "2026-11-23"
    assert looks_recent("Notice dated 12.11.2026", "https://x/a.pdf", t)
    assert looks_recent("Notice", "https://x/wp-content/uploads/2026/11/a.pdf", t)
    assert not looks_recent("Notice dated 12.08.2026", "https://x/a.pdf", t)
    assert not looks_recent("Recruitment notice", "https://x/a.pdf", t)
