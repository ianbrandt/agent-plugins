from config import parse


def test_comment_and_blank_lines_are_skipped():
    text = "# a comment\n\nname = demo\n  # indented\nport=80\n"
    assert parse(text) == {"name": "demo", "port": "80"}
