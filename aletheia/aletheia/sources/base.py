"""Abstract Source — every fetcher conforms to this contract.

A Source produces `Document` objects containing raw text + provenance.
Sources MUST:
  * never raise on partial failure — return what they can, log what failed
  * be honest about emptiness — empty list is a valid answer
  * declare their authority via `name` (looked up in SOURCE_AUTHORITY)
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Protocol

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .. import config


@dataclass(slots=True, frozen=True)
class Document:
    """A single piece of fetched text with full provenance."""
    source: str            # e.g. "wikipedia"
    source_url: str        # canonical URL (preferred) or identifier
    title: str
    text: str
    fetched_at: str        # ISO 8601 UTC
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_fetch(source: str, query: str, ok: bool, count: int, note: str = "") -> None:
    """Append a single fetch outcome to the fetch log. Best-effort."""
    rec = {
        "ts": now_iso(),
        "source": source,
        "query": query,
        "ok": ok,
        "count": count,
        "note": note,
    }
    try:
        with config.FETCH_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass  # never let logging crash a fetch


class Source(Protocol):
    """Protocol every source must satisfy."""
    name: str

    async def fetch(self, query: str, *, limit: int = 5) -> list[Document]: ...


# ────────────────────────────────────────────────────────────────────────────
# Shared HTTP helper with exponential backoff (the "robust love" layer)
# ────────────────────────────────────────────────────────────────────────────

async def http_get_with_retry(
    client: httpx.AsyncClient,
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    accept_status: Iterable[int] = (200,),
) -> httpx.Response | None:
    """GET with exponential backoff. Returns None on permanent failure."""
    try:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(config.RETRY_ATTEMPTS),
            wait=wait_exponential(multiplier=config.RETRY_BACKOFF_BASE_S, max=20),
            retry=retry_if_exception_type(
                (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError)
            ),
            reraise=True,
        ):
            with attempt:
                resp = await client.get(url, params=params, headers=headers)
                if resp.status_code not in accept_status:
                    # Don't retry 4xx (except 429), do retry 5xx
                    if 500 <= resp.status_code < 600 or resp.status_code == 429:
                        raise httpx.HTTPStatusError(
                            f"retryable status {resp.status_code}",
                            request=resp.request,
                            response=resp,
                        )
                    return None
                return resp
    except Exception:
        return None
    return None


def make_client() -> httpx.AsyncClient:
    """Standard async client with our UA and timeout."""
    return httpx.AsyncClient(
        timeout=config.HTTP_TIMEOUT_S,
        headers={"User-Agent": config.HTTP_USER_AGENT},
        follow_redirects=True,
    )
