"""sentence-transformers wrapper.

Lazy-loads the model on first use (it's ~90 MB on disk + ~300 MB resident).
Provides simple chunking that respects sentence boundaries when possible.
"""

from __future__ import annotations

import logging
import re
import threading
from typing import Iterable

import numpy as np

from . import config

log = logging.getLogger("aletheia.embedding")

_model = None
_lock = threading.Lock()


def _get_model():
    """Singleton model loader. Tolerates first-use download time."""
    global _model
    if _model is not None:
        return _model
    with _lock:
        if _model is None:
            from sentence_transformers import SentenceTransformer  # heavy import
            log.info("loading embedding model %s", config.EMBEDDING_MODEL)
            _model = SentenceTransformer(config.EMBEDDING_MODEL)
    return _model


def warmup() -> None:
    """Force the model to load up-front (useful at server startup)."""
    _get_model()


# ────────────────────────────────────────────────────────────────────────────
# Chunking — sentence-aware, target-sized, with small overlap for context.
# ────────────────────────────────────────────────────────────────────────────

_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\"'])")


def chunk_text(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= config.CHUNK_TARGET_CHARS:
        return [text]

    sentences = _SENT_SPLIT.split(text)
    chunks: list[str] = []
    buf: list[str] = []
    buf_len = 0
    for sent in sentences:
        sent = sent.strip()
        if not sent:
            continue
        if buf_len + len(sent) + 1 <= config.CHUNK_TARGET_CHARS:
            buf.append(sent)
            buf_len += len(sent) + 1
            continue
        # flush
        if buf:
            chunks.append(" ".join(buf))
        # start new with overlap from previous tail
        if chunks and config.CHUNK_OVERLAP_CHARS > 0:
            tail = chunks[-1][-config.CHUNK_OVERLAP_CHARS:]
            buf = [tail, sent]
            buf_len = len(tail) + len(sent) + 1
        else:
            buf = [sent]
            buf_len = len(sent)
    if buf:
        chunks.append(" ".join(buf))
    return chunks


def embed(texts: Iterable[str]) -> np.ndarray:
    """Return float32 ndarray of shape (N, EMBEDDING_DIM). Normalized."""
    items = [t for t in texts if t and t.strip()]
    if not items:
        return np.zeros((0, config.EMBEDDING_DIM), dtype=np.float32)
    model = _get_model()
    vecs = model.encode(
        items,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return vecs.astype(np.float32, copy=False)


def embed_one(text: str) -> np.ndarray:
    """Convenience: single embedding as 1-D ndarray."""
    arr = embed([text])
    if arr.shape[0] == 0:
        return np.zeros(config.EMBEDDING_DIM, dtype=np.float32)
    return arr[0]
