"""Feedback loop — track which queries returned weak results and flag those
topics for re-fetch / re-embed.

This is intentionally simple and inspectable. The "reinforcement signal" is
the query-time top-1 similarity: if it's below WEAK_RESULT_TOP1_SIM, the
topic is a knowledge gap or our embeddings for that topic are stale.

A topic is added to gaps.json when this happens RE_EMBED_AFTER_POOR_QUERIES
times. The CLI/learner can then proactively schedule fetches for those topics.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from . import config

log = logging.getLogger("aletheia.feedback")


def _load() -> dict:
    p = Path(config.GAPS_PATH)
    if not p.exists():
        return {"topics": {}}
    try:
        with p.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {"topics": {}}


def _save(state: dict) -> None:
    try:
        with Path(config.GAPS_PATH).open("w", encoding="utf-8") as fh:
            json.dump(state, fh, ensure_ascii=False, indent=2)
    except OSError as e:
        log.warning("gap save failed: %s", e)


def record_query(query: str, top1_similarity: float) -> dict:
    """Record a query outcome. Returns the resulting state for that topic."""
    state = _load()
    topics = state.setdefault("topics", {})
    key = query.strip().lower()
    entry = topics.setdefault(
        key,
        {"query": query, "weak_count": 0, "last_seen": "", "scheduled": False},
    )
    entry["last_seen"] = datetime.now(timezone.utc).isoformat()
    if top1_similarity < config.WEAK_RESULT_TOP1_SIM:
        entry["weak_count"] = entry.get("weak_count", 0) + 1
        if entry["weak_count"] >= config.RE_EMBED_AFTER_POOR_QUERIES:
            entry["scheduled"] = True
    else:
        # success — wind down the weak counter
        entry["weak_count"] = max(0, entry.get("weak_count", 0) - 1)
        if entry["weak_count"] == 0:
            entry["scheduled"] = False
    _save(state)
    return entry


def scheduled_gaps() -> list[str]:
    """Topics flagged for proactive re-fetch."""
    state = _load()
    return [
        v["query"] for v in state.get("topics", {}).values() if v.get("scheduled")
    ]


def clear_topic(query: str) -> None:
    state = _load()
    state.get("topics", {}).pop(query.strip().lower(), None)
    _save(state)


def all_topics() -> dict:
    return _load().get("topics", {})
