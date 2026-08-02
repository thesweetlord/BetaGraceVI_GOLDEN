"""Smoke tests — exercise the pieces that don't need network.

Run:  python -m pytest aletheia/tests -q
or:   python aletheia/tests/test_smoke.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_chunking_short():
    from aletheia.embedding import chunk_text
    assert chunk_text("Hello world.") == ["Hello world."]
    assert chunk_text("") == []


def test_chunking_long():
    from aletheia.embedding import chunk_text
    from aletheia import config
    text = ("This is sentence number one. " * 200).strip()
    chunks = chunk_text(text)
    assert len(chunks) > 1
    for c in chunks:
        # Allow some slack for sentence boundaries
        assert len(c) <= config.CHUNK_TARGET_CHARS + 200


def test_confidence_monotonic():
    from aletheia.confidence import confidence_for
    a = confidence_for("wikipedia", distinct_supporting_sources=1)
    b = confidence_for("wikipedia", distinct_supporting_sources=3)
    c = confidence_for("wikipedia", distinct_supporting_sources=5)
    assert a < b <= c


def test_confidence_authority_order():
    from aletheia.confidence import confidence_for
    arx = confidence_for("arxiv", distinct_supporting_sources=1)
    cc = confidence_for("common_crawl", distinct_supporting_sources=1)
    assert arx > cc


def test_label_thresholds():
    from aletheia.confidence import label
    assert label(0.9) == "established"
    assert label(0.6) == "tentative"
    assert label(0.2) == "uncertain"


def test_entity_extraction():
    from aletheia.knowledge_graph import extract_entities
    text = "Marie Curie discovered Polonium in Paris with Pierre Curie."
    ents = extract_entities(text)
    assert "marie curie" in ents
    assert "polonium" in ents
    assert "paris" in ents


def test_chunk_id_stable():
    from aletheia.vector_store import chunk_id, claim_hash
    a = chunk_id("https://example.com/x", 0)
    b = chunk_id("https://example.com/x", 0)
    c = chunk_id("https://example.com/x", 1)
    assert a == b and a != c
    assert claim_hash("Hello World") == claim_hash("hello world")


def test_feedback_loop():
    from aletheia import feedback, config
    test_q = "__pytest_feedback_topic__"
    feedback.clear_topic(test_q)
    for _ in range(config.RE_EMBED_AFTER_POOR_QUERIES):
        feedback.record_query(test_q, top1_similarity=0.1)
    assert test_q.lower() in {q.lower() for q in feedback.scheduled_gaps()}
    feedback.clear_topic(test_q)


if __name__ == "__main__":
    fns = [v for k, v in list(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"OK   {fn.__name__}")
        except Exception as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
