"""ChromaDB persistent vector store wrapper.

One collection: `aletheia_facts`. Each entry:
  id        — sha256(source_url + chunk_index)
  document  — the chunk text
  embedding — 384-d normalized vector (we supply, model isn't bound to chroma)
  metadata  — provenance + confidence + claim_hash
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

import numpy as np

from . import config

log = logging.getLogger("aletheia.vector_store")

COLLECTION = "aletheia_facts"

_client = None
_collection = None


def _get_collection():
    global _client, _collection
    if _collection is not None:
        return _collection
    import chromadb
    _client = chromadb.PersistentClient(path=str(config.CHROMA_DIR))
    _collection = _client.get_or_create_collection(
        name=COLLECTION,
        metadata={"hnsw:space": "cosine"},
    )
    return _collection


def chunk_id(source_url: str, chunk_index: int) -> str:
    raw = f"{source_url}#chunk={chunk_index}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def claim_hash(text: str) -> str:
    """Stable hash of normalized text for near-dedup signal in metadata."""
    norm = " ".join(text.lower().split())
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:24]


def upsert(
    *,
    ids: list[str],
    texts: list[str],
    embeddings: np.ndarray,
    metadatas: list[dict[str, Any]],
) -> None:
    if not ids:
        return
    coll = _get_collection()
    # Chroma upsert requires lists of plain Python types
    coll.upsert(
        ids=ids,
        documents=texts,
        embeddings=embeddings.tolist(),
        metadatas=metadatas,
    )


def query(
    embedding: np.ndarray,
    *,
    k: int = 8,
    where: dict | None = None,
) -> list[dict]:
    """Return top-k matches as dicts {id, text, metadata, similarity}.

    similarity = 1 - cosine_distance, clamped to [0, 1].
    """
    coll = _get_collection()
    res = coll.query(
        query_embeddings=[embedding.tolist()],
        n_results=k,
        where=where,
        include=["documents", "metadatas", "distances"],
    )
    out: list[dict] = []
    ids = (res.get("ids") or [[]])[0]
    docs = (res.get("documents") or [[]])[0]
    metas = (res.get("metadatas") or [[]])[0]
    dists = (res.get("distances") or [[]])[0]
    for i, _id in enumerate(ids):
        dist = float(dists[i]) if i < len(dists) else 1.0
        sim = max(0.0, min(1.0, 1.0 - dist))
        out.append({
            "id": _id,
            "text": docs[i] if i < len(docs) else "",
            "metadata": metas[i] if i < len(metas) else {},
            "similarity": sim,
        })
    return out


def get_by_id(_id: str) -> dict | None:
    coll = _get_collection()
    res = coll.get(ids=[_id], include=["documents", "metadatas"])
    ids = res.get("ids") or []
    if not ids:
        return None
    docs = res.get("documents") or []
    metas = res.get("metadatas") or []
    return {
        "id": ids[0],
        "text": docs[0] if docs else "",
        "metadata": metas[0] if metas else {},
    }


def update_metadata(_id: str, patch: dict) -> bool:
    """Merge `patch` into the metadata for `_id`. Returns True if applied."""
    coll = _get_collection()
    existing = get_by_id(_id)
    if existing is None:
        return False
    new_meta = {**(existing["metadata"] or {}), **patch}
    coll.update(ids=[_id], metadatas=[new_meta])
    return True


def count() -> int:
    return _get_collection().count()
