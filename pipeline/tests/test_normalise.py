from myavedan_pipeline.normalise import page_text, table_markdown
def test_table_markdown():
    md = table_markdown([["Post", "UR", "OBC", "Total"], ["Junior Clerk", "500", "215", "1215"], ["", "", "", ""]])
    assert md.splitlines()[0] == "| Post | UR | OBC | Total |"
    assert "| Junior Clerk | 500 | 215 | 1215 |" in md
    assert table_markdown([["only one cell"]]) == ""


def test_page_text_appends_tables():
    t = page_text("Vacancy details", [[["Post", "Total"], ["Clerk", "१२"]]])
    assert t.startswith("Vacancy details")
    assert "[table]" in t and "| Clerk | १२ |" in t
