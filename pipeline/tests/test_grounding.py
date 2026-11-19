from myavedan_pipeline.grounding import check_field, dates_in, find_snippet, numbers_in, value_supported

PAGE_2 = """
3. IMPORTANT DATES
Online applications open: 16.11.2026
Last date for receipt of online applications: 15.12.2026 (23:59 hrs)
Window for application form correction: 18.12.2026 to 20.12.2026 (tentative)
4. VACANCIES  Junior Assistant: 840 posts
"""


def test_exact_snippet_is_found():
    found, score = find_snippet(PAGE_2, "Last date for receipt of online applications: 15.12.2026 (23:59 hrs)")
    assert found and score == 1.0


def test_whitespace_and_case_do_not_matter():
    assert find_snippet(PAGE_2, "last DATE for receipt of   online applications")[0]


def test_small_ocr_differences_are_tolerated():
    assert find_snippet(PAGE_2, "Last date for receipt of on1ine applicatlons: 15.12.2026")[0]


def test_snippet_from_another_page_is_rejected():
    assert not find_snippet(PAGE_2, "Age limit: 18-27 years as on 01.01.2027")[0]


def test_ellipsis_parts_must_appear_in_order():
    assert find_snippet(PAGE_2, "Online applications open ... Last date for receipt")[0]
    assert not find_snippet(PAGE_2, "Last date for receipt ... Online applications open")[0]


def test_dates_in_reads_indian_formats():
    assert dates_in("from 18.12.2026 to 20/12/2026") == {"2026-12-18", "2026-12-20"}
    assert dates_in("on 5th January, 2027") == {"2027-01-05"}
    assert dates_in("on January 5, 2027") == {"2027-01-05"}
    assert dates_in("31.02.2026") == set()


def test_numbers_accept_indian_grouping():
    assert 100000.0 in numbers_in("₹1,00,000")
    assert 840.0 in numbers_in("Junior Assistant: 840 posts")


def test_value_must_be_readable_from_snippet():
    snippet = "Last date for receipt of online applications: 15.12.2026 (23:59 hrs)"
    assert value_supported("2026-12-15T23:59:00+05:30", snippet)
    assert not value_supported("2026-12-16", snippet)
    assert value_supported(840, "Junior Assistant: 840 posts")
    assert not value_supported(804, "Junior Assistant: 840 posts")


def test_check_field_combines_both_tests():
    good = check_field("2026-12-15", PAGE_2, "Last date for receipt of online applications: 15.12.2026")
    assert good["grounded"] is True
    wrong_value = check_field("2026-12-25", PAGE_2, "Last date for receipt of online applications: 15.12.2026")
    assert wrong_value["grounded"] is False and wrong_value["snippet_found"] is True
