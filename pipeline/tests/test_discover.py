from myavedan_pipeline.discover import State, classify, extract_links, on_hosts


def test_classify_recruitment_documents():
    assert classify("Detailed Advertisement for Recruitment of Assistant Engineer", "/a.pdf") == "notice"
    assert classify("CEN 08/2026 Station Master", "/forms/CEN_08_2026.pdf") == "notice"
    assert classify("Admit Card for Preliminary Examination", "/x.pdf") == "admit_card"
    assert classify("Final Result of Stenographer Grade C", "/r.pdf") == "result"
    assert classify("Tentative Answer Key", "/k.pdf") == "answer_key"
    assert classify("Corrigendum: extension of last date", "/c.pdf") == "corrigendum"


def test_classify_ignores_non_recruitment_documents():
    assert classify("Tender for supply of computers", "/t.pdf") is None
    assert classify("Annual Report 2025-26", "/ar.pdf") is None
    assert classify("Holiday list 2027", "/h.pdf") is None
    assert classify("Contact us", "/contact") is None


def test_extract_links_resolves_and_dedupes():
    html = '<a href="/notices/a.pdf">Advt A</a><a href="notices/a.pdf#page=2">Again</a><a href="javascript:void(0)">x</a><a href="mailto:x@y.in">m</a>'
    links = extract_links(html, "https://example.gov.in/recruitment/")
    assert links == [("https://example.gov.in/notices/a.pdf", "Advt A"), ("https://example.gov.in/recruitment/notices/a.pdf", "Again")]


def test_only_official_hosts():
    assert on_hosts("https://www.upsc.gov.in/x.pdf", ["upsc.gov.in"])
    assert on_hosts("https://recruitment.upsc.gov.in/x.pdf", ["upsc.gov.in"])
    assert not on_hosts("https://upsc-gov-in.example.com/x.pdf", ["upsc.gov.in"])
    assert not on_hosts("https://sarkariresult.com/upsc.pdf", ["upsc.gov.in"])


def test_state_round_trip(tmp_path):
    s = State.load(tmp_path / "state.json")
    s.seen_urls["https://a.gov.in/1.pdf"] = {"status": "backlog"}
    s.sources["a"] = {"etag": "x"}
    s.save()
    again = State.load(tmp_path / "state.json")
    assert again.seen_urls["https://a.gov.in/1.pdf"]["status"] == "backlog" and again.sources["a"]["etag"] == "x"
