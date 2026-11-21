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


def test_classify_apply_links():
    assert classify("Apply Online", "https://ibpsonline.ibps.in/crppoxvi/") == "apply_link"
    assert classify("Click here to apply for CRP PO/MT-XVI", "/apply") == "apply_link"
    # A notice that mentions online applications is still the notice, if its text says so first
    assert classify("Detailed Notification CRP PO/MT-XVI", "/Detailed-Notification.pdf") == "notice"


def test_pdf_header_may_follow_blank_bytes():
    from myavedan_pipeline.discover import is_pdf

    assert is_pdf(b"\r\n%PDF-1.7\n...")  # CISF
    assert is_pdf(b"%PDF-1.4")
    assert not is_pdf(b"<!DOCTYPE html><html>")


def test_links_with_changing_codes_are_known_by_title():
    from myavedan_pipeline.discover import link_key

    a = link_key("https://cisfrectt.cisf.gov.in/file_open.php?fnm=940kRXsCewjve6T79kzFU82JNmHWQYm2", "Corrigendum dated 09.06.2026", "cisf")
    b = link_key("https://cisfrectt.cisf.gov.in/file_open.php?fnm=kJa1LkykUlILSnbhFueGC3lSC1T7n1pw", "Corrigendum  dated 09.06.2026", "cisf")
    assert a == b == "title:cisf:corrigendum dated 09.06.2026"
    assert link_key("https://upsc.gov.in/notice.pdf?id=12", "Notice", "upsc") == "https://upsc.gov.in/notice.pdf?id=12"


def test_backlog_prefers_current_notification_pdfs():
    from myavedan_pipeline.discover import notice_score

    good = notice_score("Detailed Notification CEN 08/2026", "https://rrb.gov.in/CEN_08_2026.pdf", "2026")
    page = notice_score("Recruitment", "https://ibps.in/index.php/recruitment", "2026")
    old = notice_score("Advertisement 2019", "https://x.gov.in/advt2019.pdf", "2026")
    assert good > old > page


def test_skips_syllabus_and_fraud_warnings_and_index_links():
    assert classify("Recruitment of Paramedical Staff: Syllabus for Written Exam", "/f.pdf") is None
    assert classify("Notice for caution regarding fraudulent recruitment", "/f.pdf") is None
    assert classify("View All", "/index.php/recruitment") is None


def test_follow_a_page_to_its_notice_pdf():
    from myavedan_pipeline.discover import find_notice_pdf

    html = '<a href="/x/apply">Apply</a><a href="/docs/Detailed_Notification.pdf">Detailed Notification</a><a href="/docs/syllabus.pdf">Syllabus</a><a href="https://other.com/a.pdf">a</a>'
    assert find_notice_pdf(html, "https://ibpsreg.ibps.in/manit/", ["ibps.in"]) == "https://ibpsreg.ibps.in/docs/Detailed_Notification.pdf"
