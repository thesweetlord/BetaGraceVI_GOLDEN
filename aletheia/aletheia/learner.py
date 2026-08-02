"""Orchestrator: fetch → chunk → embed → rectify → store → graph.

Concurrency is bounded by config.MAX_CONCURRENT_FETCHES. Every step is
wrapped: a single failing source MUST NOT crash the run.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Iterable

import numpy as np

from . import embedding, knowledge_graph, rectifier
from .sources import Document, Source, all_sources
from .sources.web import fetch_web_documents
from .sources.base import now_iso

log = logging.getLogger("aletheia.learner")


async def _safe_fetch(src: Source, query: str, limit: int) -> list[Document]:
    try:
        docs = await src.fetch(query, limit=limit)
        log.info("[%s] returned %d docs for %r", src.name, len(docs), query)
        return docs
    except Exception as e:  # belt and suspenders — sources already swallow most
        log.warning("[%s] crashed on %r: %s", src.name, query, e)
        return []


async def fetch_all(
    query: str,
    *,
    limit_per_source: int = 3,
    sources: Iterable[Source] | None = None,
) -> list[Document]:
    """Fetch from every source concurrently, with bounded concurrency."""
    srcs = list(sources) if sources is not None else all_sources()
    sem = asyncio.Semaphore(max(1, min(len(srcs), 4)))

    async def gated(s: Source):
        async with sem:
            return await _safe_fetch(s, query, limit_per_source)

    results = await asyncio.gather(*(gated(s) for s in srcs))
    return [d for batch in results for d in batch]


def ingest(docs: list[Document]) -> dict:
    """Chunk + embed + rectify + persist. Returns summary stats."""
    inserted = upserted = skipped = 0
    contradictions: list[str] = []
    chunk_buf: list[tuple[Document, int, str]] = []

    for d in docs:
        for i, c in enumerate(embedding.chunk_text(d.text)):
            chunk_buf.append((d, i, c))

    if not chunk_buf:
        return {"chunks": 0, "inserted": 0, "upserted": 0, "skipped": 0, "contradictions": []}

    # Batch-embed all chunks for speed
    texts = [c for (_, _, c) in chunk_buf]
    vecs = embedding.embed(texts)

    for (doc, idx, txt), vec in zip(chunk_buf, vecs):
        rec = rectifier.rectify_and_upsert(
            doc=doc, chunk_index=idx, chunk_text=txt, embedding=np.asarray(vec)
        )
        action = rec.get("action", "insert")
        if action == "insert":
            inserted += 1
        elif action == "upsert":
            upserted += 1
        elif action == "skip-protected":
            skipped += 1
        contradictions.extend(rec.get("contradiction_flags") or [])

        # Knowledge graph from chunk text
        knowledge_graph.add_observation(txt, source=doc.source)

    knowledge_graph.save()
    return {
        "chunks": len(chunk_buf),
        "inserted": inserted,
        "upserted": upserted,
        "skipped": skipped,
        "contradictions": contradictions,
    }


async def learn(
    query: str,
    *,
    limit_per_source: int = 3,
) -> dict:
    """Top-level: pull a query through the entire pipeline."""
    docs = await fetch_all(query, limit_per_source=limit_per_source)
    summary = ingest(docs)
    summary["fetched"] = len(docs)
    summary["query"] = query
    return summary


async def learn_urls(urls: list[str], *, limit_per_source: int = 3) -> dict:
    urls = [u.strip() for u in urls if u.strip()]
    if not urls:
        return {"fetched": 0, "chunks": 0, "inserted": 0, "upserted": 0, "skipped": 0, "contradictions": [], "urls": []}
    urls = urls[:max(1, min(limit_per_source, len(urls)))]
    docs = await fetch_web_documents(urls)
    summary = ingest(docs)
    summary["fetched"] = len(docs)
    summary["urls"] = urls
    return summary


def ingest_documents(raw_docs: list[dict]) -> dict:
    docs: list[Document] = []
    for raw in raw_docs:
        source = str(raw.get("source", "knowledge_dump")).strip() or "knowledge_dump"
        source_url = str(raw.get("source_url", "")).strip()
        title = str(raw.get("title", source_url or source)).strip() or source_url or source
        text = str(raw.get("text", "")).strip()
        if not source_url or not text:
            continue
        docs.append(Document(
            source=source,
            source_url=source_url,
            title=title,
            text=text,
            fetched_at=now_iso(),
            extra={k: v for k, v in dict(raw).items() if k not in {"source", "source_url", "title", "text"}},
        ))

    summary = ingest(docs)
    summary["documents"] = len(docs)
    return summary
