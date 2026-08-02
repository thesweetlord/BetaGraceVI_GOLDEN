"""NetworkX-backed knowledge graph, persisted as a pickle.

Nodes are entity strings (lowercased, stripped). Edges carry:
  weight       — float, accumulates with each co-occurrence
  sources      — set of source names that contributed
  last_updated — ISO timestamp

Entity extraction is intentionally simple: lower-cased multi-word
proper-noun-ish tokens from the chunk title + a capitalized-bigram heuristic.
You can swap in spaCy NER later without changing the public API here.
"""

from __future__ import annotations

import logging
import pickle
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

import networkx as nx

from . import config

log = logging.getLogger("aletheia.kg")

_graph: nx.Graph | None = None
_lock = threading.Lock()


# ────────────────────────────────────────────────────────────────────────────
# Persistence
# ────────────────────────────────────────────────────────────────────────────

def _load() -> nx.Graph:
    p = Path(config.GRAPH_PATH)
    if not p.exists():
        return nx.Graph()
    try:
        with p.open("rb") as fh:
            g = pickle.load(fh)
        if not isinstance(g, nx.Graph):
            log.warning("graph pickle wrong type — starting fresh")
            return nx.Graph()
        return g
    except Exception as e:
        log.warning("could not load graph pickle (%s) — starting fresh", e)
        return nx.Graph()


def _save(g: nx.Graph) -> None:
    tmp = Path(str(config.GRAPH_PATH) + ".tmp")
    try:
        with tmp.open("wb") as fh:
            pickle.dump(g, fh, protocol=pickle.HIGHEST_PROTOCOL)
        tmp.replace(config.GRAPH_PATH)
    except OSError as e:
        log.warning("graph save failed: %s", e)


def get_graph() -> nx.Graph:
    global _graph
    if _graph is None:
        with _lock:
            if _graph is None:
                _graph = _load()
    return _graph


def save() -> None:
    if _graph is not None:
        _save(_graph)


# ────────────────────────────────────────────────────────────────────────────
# Entity extraction (simple, replaceable)
# ────────────────────────────────────────────────────────────────────────────

_TOKEN = re.compile(r"\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]+)*\b")
_STOP = {"the", "and", "for", "with", "from", "that", "this", "into"}


def extract_entities(text: str, *, max_entities: int = 25) -> list[str]:
    seen: dict[str, int] = {}
    for m in _TOKEN.finditer(text):
        entity = m.group(0).strip()
        key = entity.lower()
        if key in _STOP or len(key) < 3:
            continue
        seen[key] = seen.get(key, 0) + 1
    # Most-frequent first
    ranked = sorted(seen.items(), key=lambda kv: kv[1], reverse=True)
    return [e for e, _ in ranked[:max_entities]]


# ────────────────────────────────────────────────────────────────────────────
# Update
# ────────────────────────────────────────────────────────────────────────────

def add_observation(text: str, *, source: str) -> int:
    """Add co-occurrence edges among entities found in `text`. Returns # edges."""
    g = get_graph()
    entities = extract_entities(text)
    if len(entities) < 2:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    edges_added = 0
    for i, a in enumerate(entities):
        if not g.has_node(a):
            g.add_node(a, first_seen=now)
        for b in entities[i + 1 :]:
            if not g.has_node(b):
                g.add_node(b, first_seen=now)
            if g.has_edge(a, b):
                d = g[a][b]
                d["weight"] = d.get("weight", 1.0) + 1.0
                srcs = set(d.get("sources", []))
                srcs.add(source)
                d["sources"] = sorted(srcs)
                d["last_updated"] = now
            else:
                g.add_edge(
                    a,
                    b,
                    weight=1.0,
                    sources=[source],
                    last_updated=now,
                )
                edges_added += 1
    return edges_added


def neighbors(entity: str, *, top: int = 10) -> list[tuple[str, float, list[str]]]:
    """Return (neighbor, weight, sources) tuples sorted by weight desc."""
    g = get_graph()
    key = entity.lower()
    if not g.has_node(key):
        return []
    out: list[tuple[str, float, list[str]]] = []
    for nb in g.neighbors(key):
        d = g[key][nb]
        out.append((nb, float(d.get("weight", 0.0)), list(d.get("sources", []))))
    out.sort(key=lambda t: t[1], reverse=True)
    return out[:top]


def stats() -> dict:
    g = get_graph()
    return {
        "nodes": g.number_of_nodes(),
        "edges": g.number_of_edges(),
        "graph_path": str(config.GRAPH_PATH),
    }
