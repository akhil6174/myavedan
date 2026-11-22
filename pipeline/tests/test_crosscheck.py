from myavedan_pipeline.crosscheck import crosscheck


def _draft(**kw):
    d = {"dates": [], "posts": [], "fees": [], "total_vacancies": None}
    d.update(kw)
    return d


def codes(flags):
    return sorted(f["code"] for f in flags)


def test_last_date_disagreement():
    pages = {3: "Last date for submission of online application: 15.12.2026 (23:59)"}
    assert codes(crosscheck(_draft(dates=[{"kind": "apply_end", "value": "2026-12-15T23:59"}]), pages)) == []
    flags = crosscheck(_draft(dates=[{"kind": "apply_end", "value": "2026-12-05"}]), pages)
    assert codes(flags) == ["second_check_last_date"] and "2026-12-15" in flags[0]["message"]


def test_total_vacancies_and_sum():
    pages = {4: "Total No. of Posts: 1,215"}
    assert codes(crosscheck(_draft(total_vacancies=1215), pages)) == []
    assert codes(crosscheck(_draft(total_vacancies=1265), pages)) == ["second_check_vacancies"]
    posts = [{"vacancies": 500, "rules": []}, {"vacancies": 700, "rules": []}]
    assert "vacancies_dont_add_up" in codes(crosscheck(_draft(total_vacancies=1215, posts=posts), {1: ""}))


def test_age_range():
    pages = {5: "Age limit: 18 to 27 years as on 01.01.2027"}
    ok = {"kind": "dob_window", "born_on_or_after": "1999-01-02", "as_on": "2027-01-01"}
    bad = {"kind": "dob_window", "born_on_or_after": "1994-01-02", "as_on": "2027-01-01"}
    assert codes(crosscheck(_draft(posts=[{"rules": [ok]}]), pages)) == []
    assert codes(crosscheck(_draft(posts=[{"rules": [bad]}]), pages)) == ["second_check_age"]


def test_fee():
    pages = {9: "Application fee: Rs. 100/- for General candidates"}
    assert codes(crosscheck(_draft(fees=[{"amount_inr": 100}]), pages)) == []
    assert codes(crosscheck(_draft(fees=[{"amount_inr": 500}]), pages)) == ["second_check_fee"]


def test_nothing_found_flags_nothing():
    assert crosscheck(_draft(total_vacancies=10, fees=[{"amount_inr": 50}], dates=[{"kind": "apply_end", "value": "2026-12-01"}]), {1: "General instructions"}) == []
