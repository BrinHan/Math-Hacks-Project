import re
from pathlib import Path

from aed.params import CITATIONS, RANGES

# Parameters with no verified direct source; documented in docs/sources.md.
ALLOWED_ASSUMPTIONS = {"dispatch_delay_s"}
SOURCES = Path(__file__).resolve().parent.parent / "docs" / "sources.md"


def test_numeric_params_are_sourced():
    for key in RANGES:
        if key in ALLOWED_ASSUMPTIONS:
            continue
        c = CITATIONS[key]
        assert not c.startswith("ASSUMPTION:"), key
        assert re.search(r"(19|20)\d\d", c), key
        assert "http" in c, key


def test_sources_doc_lists_every_url():
    doc = SOURCES.read_text(encoding="utf-8")
    for key, c in CITATIONS.items():
        for url in re.findall(r"https?://\S+", c):
            url = url.rstrip(").,;:")
            assert url in doc, f"{key}: {url} missing from docs/sources.md"
