"""Query engine — retrieves cited evidence for a question.

This intentionally does NOT generate prose answers. It returns evidence:
the most relevant text chunks with full citations and confidence labels.
The caller (CLI prints them; the BetaGrace bridge feeds them to the LLM
as grounded context) is responsible for any synthesis. This is the
epistemic-honesty boundary — the engine reports what it has, never invents.
"""

from __future__ import annotations

import json
from typing import Any

from . import config, embedding, feedback, knowledge_graph, vector_store


def ask(question: str, *, k: int = 8) -> dict[str, Any]:
    """Return a structured answer-with-evidence for `question`.

    Shape:
      {
        "question": str,
        "answer_status": "established" | "tentative" | "uncertain" | "unknown",
        "evidence": [ {text, similarity, confidence, label, source, source_url,
                       title, fetched_at, supporting_sources, contradiction_flags} ],
        "related_entities": [ (entity, weight, sources) ],
        "best_similarity": float,
      }
    """
    q = (question or "").strip()
    if not q:
        return {
            "question": question,
            "answer_status": "unknown",
            "evidence": [],
            "related_entities": [],
            "best_similarity": 0.0,
        }

    qvec = embedding.embed_one(q)
    hits = vector_store.query(qvec, k=k)

    evidence: list[dict] = []
    best_sim = 0.0
    best_conf = 0.0
    for h in hits:
        meta = dict(h.get("metadata") or {})
        sim = float(h.get("similarity", 0.0))
        conf = float(meta.get("confidence", 0.0))
        best_sim = max(best_sim, sim)
        best_conf = max(best_conf, conf)
        # Decode JSON-encoded lists in metadata
        try:
            supporting = json.loads(meta.get("supporting_sources") or "[]")
        except ValueError:
            supporting = []
        try:
            contradictions = json.loads(meta.get("contradiction_flags") or "[]")
        except ValueError:
            contradictions = []
        evidence.append({
            "text": h.get("text", ""),
            "similarity": sim,
            "confidence": conf,
            "label": meta.get("label", "uncertain"),
            "source": meta.get("source", "?"),
            "source_url": meta.get("source_url", ""),
            "title": meta.get("title", ""),
            "fetched_at": meta.get("fetched_at", ""),
            "supporting_sources": supporting,
            "contradiction_flags": contradictions,
        })

    # Update the feedback loop
    feedback.record_query(q, best_sim)

    if not evidence or best_sim < config.UNCERTAIN_BELOW:
        status = "unknown"
    elif best_conf >= config.ESTABLISHED_AT and best_sim >= 0.6:
        status = "established"
    elif best_conf < config.UNCERTAIN_BELOW:
        status = "uncertain"
    else:
        status = "tentative"

    # Related entities from the knowledge graph (cheap signal)
    entities = []
    for tok in q.lower().split():
        if len(tok) >= 4:
            entities.extend(knowledge_graph.neighbors(tok, top=3))
    # Dedup by name
    seen = set()
    related: list[tuple[str, float, list[str]]] = []
    for nb, wt, srcs in sorted(entities, key=lambda t: t[1], reverse=True):
        if nb in seen:
            continue
        seen.add(nb)
        related.append((nb, wt, srcs))
        if len(related) >= 6:
            break

    return {
        "question": q,
        "answer_status": status,
        "evidence": evidence,
        "related_entities": related,
        "best_similarity": best_sim,
    }
