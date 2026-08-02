"""Project Gutenberg source.

Uses Gutendex (https://gutendex.com), an unofficial but stable JSON API for
Project Gutenberg. Returns metadata + grabs the plain-text body when possible.
We truncate to a reasonable size — Gutenberg books are huge and we are
embedding excerpts, not whole novels.
"""

from __future__ import annotations

from .base import Document, http_get_with_retry, log_fetch, make_client, now_iso

MAX_BODY_CHARS = 80_000  # ~30 pages; enough for embedding/excerpting


class GutenbergSource:
    name = "gutenberg"

    async def fetch(self, query: str, *, limit: int = 5) -> list[Document]:
        async with make_client() as client:
            search = await http_get_with_retry(
                client,
                "https://gutendex.com/books",
                params={"search": query, "languages": "en"},
            )
            if search is None:
                log_fetch(self.name, query, ok=False, count=0, note="search failed")
                return []

            try:
                results = search.json().get("results", [])[:limit]
            except ValueError:
                log_fetch(self.name, query, ok=False, count=0, note="bad json")
                return []

            docs: list[Document] = []
            for book in results:
                title = book.get("title") or "Untitled"
                authors = ", ".join(
                    (a.get("name") or "Unknown") for a in (book.get("authors") or [])
                )
                fmts = book.get("formats", {})
                # Prefer plain-text-utf-8, fall back to plain-text
                text_url = (
                    fmts.get("text/plain; charset=utf-8")
                    or fmts.get("text/plain; charset=us-ascii")
                    or fmts.get("text/plain")
                )
                if not text_url:
                    continue
                body = await http_get_with_retry(client, text_url)
                if body is None:
                    continue
                content = body.text[:MAX_BODY_CHARS].strip()
                if not content:
                    continue
                docs.append(
                    Document(
                        source=self.name,
                        source_url=text_url,
                        title=f"{title} — {authors}" if authors else title,
                        text=content,
                        fetched_at=now_iso(),
                        extra={"id": book.get("id"), "subjects": book.get("subjects")},
                    )
                )

        log_fetch(self.name, query, ok=bool(docs), count=len(docs))
        return docs
