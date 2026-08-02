"""FastAPI service — the surface BetaGrace (TS) calls.

Endpoints:
  GET  /health
  GET  /status
  POST /ask    {question, k?}     → cited evidence
  POST /learn  {topic, limit?}    → fetches + ingests
  GET  /gaps                      → list of scheduled gap topics

Auth: optional shared-secret header `X-Aletheia-Token` matched against the
ALETHEIA_TOKEN environment variable (skipped when the env var is unset, so
local development works out of the box).
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import config, embedding, feedback, knowledge_graph, learner, query, vector_store

log = logging.getLogger("aletheia.api")


SKIP_WARMUP = os.environ.get("ALETHEIA_SKIP_WARMUP", "0").lower() in {"1", "true", "yes"}


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Optionally warm the embedding model up-front so first requests aren't slow."""
    if not SKIP_WARMUP:
        log.info("warming embedding model")
        try:
            embedding.warmup()
        except Exception as e:
            log.warning("warmup failed (will lazy-load on first use): %s", e)
    else:
        log.info("ALETHEIA_SKIP_WARMUP enabled; skipping embedding warmup")
    yield
    # No teardown needed — Chroma persists on every write, graph is saved
    # at end of every learn() run.


app = FastAPI(
    title="Aletheia",
    version="0.1.0",
    description="Self-improving, citation-honest knowledge engine.",
    lifespan=_lifespan,
)


def _auth(x_aletheia_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("ALETHEIA_TOKEN")
    if not expected:
        return  # auth disabled in dev
    if x_aletheia_token != expected:
        raise HTTPException(status_code=401, detail="invalid token")


# ────────────────────────────────────────────────────────────────────────────
# Request / response models
# ────────────────────────────────────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str = Field(..., min_length=1)
    k: int = Field(6, ge=1, le=25)


class LearnRequest(BaseModel):
    topic: str = Field(..., min_length=1)
    limit: int = Field(3, ge=1, le=10)


class LearnUrlRequest(BaseModel):
    urls: list[str] = Field(..., min_length=1)
    limit: int = Field(3, ge=1, le=10)


class IngestDocument(BaseModel):
    source: str = Field("knowledge_dump", min_length=1)
    source_url: str = Field(..., min_length=1)
    title: str | None = None
    text: str = Field(..., min_length=1)
    extra: dict[str, Any] = Field(default_factory=dict)


class IngestRequest(BaseModel):
    docs: list[IngestDocument] = Field(..., min_length=1)


# ────────────────────────────────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "aletheia", "version": app.version}


@app.get("/status", dependencies=[Depends(_auth)])
def status() -> dict[str, Any]:
    return {
        "chunks": vector_store.count(),
        "graph": knowledge_graph.stats(),
        "scheduled_gaps": feedback.scheduled_gaps(),
        "data_dir": str(config.DATA_DIR),
    }


@app.post("/ask", dependencies=[Depends(_auth)])
def ask(req: AskRequest) -> dict[str, Any]:
    return query.ask(req.question, k=req.k)


@app.post("/learn", dependencies=[Depends(_auth)])
async def learn(req: LearnRequest) -> dict[str, Any]:
    return await learner.learn(req.topic, limit_per_source=req.limit)


@app.post("/learn-url", dependencies=[Depends(_auth)])
async def learn_url(req: LearnUrlRequest) -> dict[str, Any]:
    return await learner.learn_urls(req.urls, limit_per_source=req.limit)


@app.post("/ingest", dependencies=[Depends(_auth)])
def ingest(req: IngestRequest) -> dict[str, Any]:
    return learner.ingest_documents([doc.model_dump() for doc in req.docs])


@app.get("/gaps", dependencies=[Depends(_auth)])
def gaps() -> dict[str, Any]:
    return {
        "scheduled": feedback.scheduled_gaps(),
        "all": feedback.all_topics(),
    }
