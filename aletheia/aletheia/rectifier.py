"""Rectification: cross-reference, agreement counting, contradiction flagging.

Workflow when a new chunk arrives:
  1. Embed it.
  2. Search vector store for top-K neighbors above SIMILARITY_THRESHOLD.
  3. Count DISTINCT sources represented in the neighbors (plus self).
  4. Compute confidence (confidence.py).
  5. Detect contradiction signals: same near-text but mismatching titles or
     conflicting metadata claims (faithful, lightweight heuristic — full
     semantic-contradiction detection is a research problem we don't pretend
     to solve).
  6. Decide: insert / upsert / skip (skip if existing confidence is much
     higher and overwrite would be a regression).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Iterable

import numpy as np

from . import config, confidence, vector_store
from .sources import Document

log = logging.getLogger("aletheia.rectifier")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _log_update(record: dict) -> None:
    try:
        with config.UPDATE_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _distinct_sources(neighbors: Iterable[dict], self_source: str) -> set[str]:
    sources = {self_source}
    for n in neighbors:
        s = (n.get("metadata") or {}).get("source")
        if s:
            sources.add(s)
    return sources


def _detect_contradiction(neighbors: list[dict], self_doc: Document) -> list[str]:
    """Cheap, honest contradiction signals.

    A "contradiction" here is: highly-similar text but with title disagreement
    that suggests two sources are talking about different referents under the
    same wording. This is a SIGNAL, not proof. It gets logged for review.
    """
    flags: list[str] = []
    self_title_norm = " ".join(self_doc.title.lower().split())
    for n in neighbors:
        sim = n.get("similarity", 0.0)
        if sim < 0.92:  # only flag near-duplicates
            continue
        meta = n.get("metadata") or {}
        other_title = " ".join(str(meta.get("title", "")).lower().split())
        if not other_title or other_title == self_title_norm:
            continue
        # If both titles share zero significant words AND they're near-duplicates,
        # something is off (could be plagiarism, could be different referent).
        a_words = {w for w in self_title_norm.split() if len(w) > 3}
        b_words = {w for w in other_title.split() if len(w) > 3}
        if a_words and b_words and not (a_words & b_words):
            flags.append(
                f"near-duplicate text (sim={sim:.2f}) under disjoint titles: "
                f"{self_doc.title!r} vs {meta.get('title')!r} "
                f"({self_doc.source} vs {meta.get('source')})"
            )
    return flags


def rectify_and_upsert(
    *,
    doc: Document,
    chunk_index: int,
    chunk_text: str,
    embedding: np.ndarray,
) -> dict:
    """Rectify + upsert one chunk. Returns a record describing what happened."""
    _id = vector_store.chunk_id(doc.source_url, chunk_index)
    neighbors = vector_store.query(embedding, k=8)
    # Restrict to "near match" neighbors (excluding self if already stored)
    near = [
        n for n in neighbors
        if n["similarity"] >= config.SIMILARITY_THRESHOLD and n["id"] != _id
    ]
    distinct = _distinct_sources(near, doc.source)
    conf = confidence.confidence_for(
        doc.source, distinct_supporting_sources=len(distinct)
    )
    contradictions = _detect_contradiction(near, doc)

    # Honest overwrite guard
    existing = vector_store.get_by_id(_id)
    action = "insert"
    if existing is not None:
        existing_conf = float((existing["metadata"] or {}).get("confidence", 0.0))
        if not confidence.should_overwrite(
            existing_confidence=existing_conf, incoming_confidence=conf
        ):
            action = "skip-protected"
            record = {
                "ts": _now(),
                "id": _id,
                "action": action,
                "source": doc.source,
                "title": doc.title,
                "incoming_confidence": conf,
                "existing_confidence": existing_conf,
                "distinct_sources": sorted(distinct),
                "contradiction_flags": contradictions,
            }
            _log_update(record)
            return record
        action = "upsert"

    metadata = {
        "source": doc.source,
        "source_url": doc.source_url,
        "title": doc.title,
        "fetched_at": doc.fetched_at,
        "chunk_index": chunk_index,
        "claim_hash": vector_store.claim_hash(chunk_text),
        "confidence": conf,
        "supporting_sources": json.dumps(sorted(distinct)),
        "contradiction_flags": json.dumps(contradictions),
        "label": confidence.label(conf),
    }
    vector_store.upsert(
        ids=[_id],
        texts=[chunk_text],
        embeddings=embedding.reshape(1, -1),
        metadatas=[metadata],
    )

    # Promote corroborated neighbors too — they now have one more supporter.
    for n in near:
        meta = dict(n.get("metadata") or {})
        nb_source = meta.get("source")
        if not nb_source:
            continue
        # Recount distinct sources for this neighbor by re-querying its neighborhood
        nb_neighbors = vector_store.query(np.asarray(embedding), k=8)
        nb_distinct = _distinct_sources(
            [x for x in nb_neighbors if x["id"] != n["id"]], nb_source
        )
        new_conf = confidence.confidence_for(
            nb_source, distinct_supporting_sources=len(nb_distinct)
        )
        old_conf = float(meta.get("confidence", 0.0))
        if new_conf > old_conf:
            vector_store.update_metadata(
                n["id"],
                {
                    "confidence": new_conf,
                    "supporting_sources": json.dumps(sorted(nb_distinct)),
                    "label": confidence.label(new_conf),
                },
            )

    record = {
        "ts": _now(),
        "id": _id,
        "action": action,
        "source": doc.source,
        "title": doc.title,
        "confidence": conf,
        "label": confidence.label(conf),
        "distinct_sources": sorted(distinct),
        "contradiction_flags": contradictions,
    }
    _log_update(record)
    return record
