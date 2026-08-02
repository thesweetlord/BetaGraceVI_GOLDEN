"""Web browsing source and raw web document ingestion."""

from __future__ import annotations

from typing import Any

import asyncio

from bs4 import BeautifulSoup
from .base import Document, http_get_with_retry, log_fetch, make_client, now_iso


async def _fetch_url(client: Any, url: str) -> Document | None:
    resp = await http_get_with_retry(
        client,
        url,
        headers={"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
    )
    if resp is None:
        log_fetch("web", url, ok=False, count=0, note="fetch failed")
        return None

    content_type = resp.headers.get("content-type", "")
    text = resp.text or ""
    title = url

    if "html" in content_type.lower() or "xml" in content_type.lower():
        try:
            soup = BeautifulSoup(text, "lxml")
            for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "aside"]):
                tag.decompose()
            title_tag = soup.title
            if title_tag and title_tag.string:
                title = title_tag.string.strip()
            body = soup.get_text(separator=" \n ", strip=True)
            text = "\n\n".join(line for line in body.splitlines() if line.strip())
        except Exception:
            text = resp.text or ""
    else:
        text = resp.text or ""

    if not text.strip():
        log_fetch("web", url, ok=False, count=0, note="empty text")
        return None

    doc = Document(
        source="web",
        source_url=url,
        title=title,
        text=text.strip(),
        fetched_at=now_iso(),
        extra={"content_type": content_type},
    )
    log_fetch("web", url, ok=True, count=1)
    return doc


async def fetch_web_documents(urls: list[str]) -> list[Document]:
    docs: list[Document] = []
    if not urls:
        return docs

    async with make_client() as client:
        tasks = [_fetch_url(client, url) for url in urls]
        results = await __import__("asyncio").gather(*tasks)

    for doc in results:
        if doc is not None:
            docs.append(doc)
    return docs
