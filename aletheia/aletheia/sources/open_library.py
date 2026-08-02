"""Open Library source — uses the public Search and Works APIs.

Returns book metadata + the work's description (when present). Useful for
bibliographic facts and short canonical descriptions, not for full-text.
"""

from __future__ import annotations

from .base import Document, http_get_with_retry, log_fetch, make_client, now_iso


def _description_text(desc) -> str:
    """Open Library descriptions can be a string OR {'value': str}."""
    if isinstance(desc, str):
        return desc
    if isinstance(desc, dict):
        return str(desc.get("value", "")) or ""
    return ""


class OpenLibrarySource:
    name = "open_library"

    async def fetch(self, query: str, *, limit: int = 5) -> list[Document]:
        async with make_client() as client:
            search = await http_get_with_retry(
                client,
                "https://openlibrary.org/search.json",
                params={"q": query, "limit": str(limit)},
            )
            if search is None:
                log_fetch(self.name, query, ok=False, count=0, note="search failed")
                return []

            try:
                docs_raw = search.json().get("docs", [])[:limit]
            except ValueError:
                log_fetch(self.name, query, ok=False, count=0, note="bad json")
                return []

            docs: list[Document] = []
            for entry in docs_raw:
                title = entry.get("title")
                key = entry.get("key")  # e.g. /works/OL12345W
                if not title or not key:
                    continue
                authors = ", ".join(entry.get("author_name") or [])
                year = entry.get("first_publish_year")

                # Try fetching the work for a description
                description = ""
                work = await http_get_with_retry(
                    client, f"https://openlibrary.org{key}.json"
                )
                if work is not None:
                    try:
                        description = _description_text(work.json().get("description", ""))
                    except ValueError:
                        description = ""

                # Compose a useful text body (description + bibliographic facts)
                bits = [
                    f"Title: {title}",
                    f"Author(s): {authors}" if authors else "",
                    f"First published: {year}" if year else "",
                    description.strip(),
                ]
                text = "\n".join(b for b in bits if b).strip()
                if not text:
                    continue
                docs.append(
                    Document(
                        source=self.name,
                        source_url=f"https://openlibrary.org{key}",
                        title=title,
                        text=text,
                        fetched_at=now_iso(),
                        extra={"authors": authors, "year": year},
                    )
                )

        log_fetch(self.name, query, ok=bool(docs), count=len(docs))
        return docs
