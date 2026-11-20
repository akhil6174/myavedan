from myavedan_pipeline.convert import dob_window, ground_and_flag, slugify, to_draft

ORG = {"name": "Staff Selection Commission", "jurisdiction": "central", "state": None, "domain": "ssc.gov.in"}


def test_dob_window_prefers_the_stated_window():
    assert dob_window({"born_on_or_after": "1999-01-02", "born_on_or_before": "2009-01-01", "as_on": "2027-01-01", "min_age": 18, "max_age": 27}) == ("1999-01-02", "2009-01-01")


def test_dob_window_from_ages_matches_how_notices_word_it():
    # 18-27 years on 01.01.2027 == born not before 02.01.1999 and not after 01.01.2009
    assert dob_window({"as_on": "2027-01-01", "min_age": 18, "max_age": 27, "born_on_or_after": "", "born_on_or_before": ""}) == ("1999-01-02", "2009-01-01")


def test_dob_window_needs_an_age_and_a_cutoff():
    assert dob_window({"as_on": "", "min_age": 18, "max_age": 27}) is None
    assert dob_window({"as_on": "2027-01-01", "min_age": -1, "max_age": -1}) is None


def test_dob_window_with_only_a_maximum_age():
    # SBI: "Maximum 50 years (As on 31.10.2026)"
    assert dob_window({"as_on": "2026-10-31", "min_age": -1, "max_age": 50, "born_on_or_after": "", "born_on_or_before": ""}) == ("1975-11-01", "2026-10-31")


def test_dob_window_handles_29_february():
    after, before = dob_window({"as_on": "2028-02-29", "min_age": 18, "max_age": 30, "born_on_or_after": "", "born_on_or_before": ""})
    # Born 28 Feb 2010: turns 18 on 28 Feb 2028, so is 18 on 29 Feb. Born 1 Mar 2010: not yet.
    # Born 28 Feb 1997: turns 31 on 28 Feb 2028, too old. Born 1 Mar 1997: still 30 on 29 Feb.
    assert before == "2010-02-28" and after == "1997-03-01"


def test_slugify():
    assert slugify("SSC", "Stenographer Grade 'C' & 'D' 2026") == "ssc-stenographer-grade-c-d-2026"


EXTRACTION = {
    "title": "Stenographer Grade C and D Examination 2026",
    "organization_name": "Staff Selection Commission",
    "advt_no": "",
    "summary_en": "Recruitment of stenographers.",
    "total_vacancies": -1,
    "apply_url": "https://ssc.gov.in/apply",
    "dates": [
        {"kind": "apply_end", "date": "2026-12-15", "time": "23:00", "approx": "", "tentative": False, "page": 2, "section": "", "snippet": "Last date for receipt of online applications: 15.12.2026 (23:00)"},
        {"kind": "exam", "date": "", "time": "", "approx": "February 2027", "tentative": True, "page": 2, "section": "", "snippet": "Computer Based Examination: February 2027"},
    ],
    "posts": [
        {
            "name": "Stenographer Grade C", "vacancies": -1, "pay": "", "location": "", "page": 3, "section": "", "snippet": "Stenographer Grade C",
            "age": {"min_age": 18, "max_age": 30, "as_on": "2027-01-01", "born_on_or_after": "", "born_on_or_before": "", "stated": "18-30 years as on 01.01.2027",
                    "page": 4, "section": "", "snippet": "18-30 years as on 01.01.2027",
                    "relaxations": [{"group": "OBC", "years": 3, "cumulative": False, "page": 4, "snippet": "OBC: 3 years"}, {"group": "ESM", "years": -1, "cumulative": False, "page": 4, "snippet": "as per rules"}]},
            "qualification": {"min_level": "12th", "held_by": "2026-12-15", "final_year_allowed": "not_stated", "subjects": [], "stated": "12th pass", "page": 5, "section": "", "snippet": "12th Standard pass"},
            "other_conditions": [],
        }
    ],
    "fees": [{"applies_to": "General", "amount_inr": 100, "page": 6, "snippet": "Fee payable: Rs 100"}],
    "selection_stages": ["Computer based examination", "Skill test"],
    "documents_required": [],
}


def test_to_draft_builds_the_site_format():
    d = to_draft(EXTRACTION, organization=ORG, notice_url="https://ssc.gov.in/notice.pdf", official_page="https://ssc.gov.in/", today="2026-11-20")
    assert d["slug"] == "stenographer-grade-c-and-d-examination-2026"
    end = next(x for x in d["dates"] if x["kind"] == "apply_end")
    assert end["value"] == "2026-12-15T23:00:00+05:30"
    exam = next(x for x in d["dates"] if x["kind"] == "exam")
    assert exam["value"] is None and exam["approx"] == "February 2027"
    rule = d["posts"][0]["rules"][0]
    assert (rule["born_on_or_after"], rule["born_on_or_before"]) == ("1996-01-02", "2009-01-01")
    assert rule["relaxations"][1]["years"] is None  # "as per rules" stays unknown
    assert d["posts"][0]["rules"][1]["final_year_allowed"] is None
    assert d["qualification_levels"] == ["12th"]
    assert d["locations"] == ["All India"]
    assert d["total_vacancies"] is None


def test_grounding_and_flags():
    d = to_draft(EXTRACTION, organization=ORG, notice_url="https://ssc.gov.in/notice.pdf", official_page="https://ssc.gov.in/", today="2026-11-20")
    pages = {2: "Last date for receipt of online applications: 15.12.2026 (23:00)\nComputer Based Examination: February 2027", 4: "18-30 years as on 01.01.2027\nOBC: 3 years", 6: "Fee payable: Rs 100"}
    draft, flags = ground_and_flag(d, pages, ["ssc.gov.in"], unread_pages=[22, 23])
    keys = {k: v["grounded"] for k, v in draft["grounding"].items()}
    end_key = f"dates.{[x['kind'] for x in draft['dates']].index('apply_end')}"
    assert keys[end_key] is True
    assert keys["fees.0"] is True
    assert keys["posts.0.rules.1"] is False  # page 5 text not provided
    codes = {f["code"] for f in flags}
    assert "unread_pages" in codes and "ungrounded" in codes
    assert "_host" not in draft


def test_links_without_a_scheme_become_https():
    from myavedan_pipeline.convert import normalise_url

    assert normalise_url("www.ibps.in") == "https://www.ibps.in"
    assert normalise_url("https://ibps.in/apply).") == "https://ibps.in/apply"
    assert normalise_url("") is None
    assert normalise_url("not a link") is None
