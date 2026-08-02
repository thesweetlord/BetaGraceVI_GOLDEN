"""arXiv source — public Atom API. No key. Returns abstracts, not PDFs.

Abstracts carry most of the cite-able knowledge claims and are far cheaper to
embed than full papers. When a user wants the paper, they have the URL.
"""

from __future__ import annotations

import feedparser

from .base import Document, http_get_with_retry, log_fetch, make_client, now_iso


class ArxivSource:
    name = "arxiv"

    async def fetch(self, query: str, *, limit: int = 5) -> list[Document]:
        async with make_client() as client:
            resp = await http_get_with_retry(
                client,
                "http://export.arxiv.org/api/query",
                params={
                    "search_query": f"all:{query}",
                    "start": "0",
                    "max_results": str(limit),
                    "sortBy": "relevance",
                    "sortOrder": "descending",
                },
            )
            if resp is None:
                log_fetch(self.name, query, ok=False, count=0, note="api failed")
                return []

        # feedparser is sync; the response body is small, parsing is fast
        feed = feedparser.parse(resp.text)
        docs: list[Document] = []
        for entry in feed.entries[:limit]:
            title = (entry.get("title") or "").strip().replace("\n", " ")
            summary = (entry.get("summary") or "").strip().replace("\n", " ")
            if not summary:
                continue
            url = entry.get("link") or entry.get("id") or ""
            authors = ", ".join(a.get("name", "") for a in entry.get("authors", []) if a.get("name"))
            published = entry.get("published") or entry.get("updated") or ""
            docs.append(
                Document(
                    source=self.name,
                    source_url=url,
                    title=title,
                    text=summary,
                    fetched_at=now_iso(),
                    extra={"authors": authors, "published": published},
                )
            )

        log_fetch(self.name, query, ok=bool(docs), count=len(docs))
        return docs
