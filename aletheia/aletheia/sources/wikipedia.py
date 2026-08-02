"""Wikipedia source — uses the public REST API. No key required."""

from __future__ import annotations

from .base import Document, Source, http_get_with_retry, log_fetch, make_client, now_iso


class WikipediaSource:
    name = "wikipedia"

    async def fetch(self, query: str, *, limit: int = 5) -> list[Document]:
        async with make_client() as client:
            # Step 1: search for matching article titles
            search = await http_get_with_retry(
                client,
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "list": "search",
                    "srsearch": query,
                    "srlimit": str(limit),
                    "format": "json",
                },
            )
            if search is None:
                log_fetch(self.name, query, ok=False, count=0, note="search failed")
                return []

            try:
                hits = search.json().get("query", {}).get("search", [])
            except ValueError:
                log_fetch(self.name, query, ok=False, count=0, note="bad json")
                return []

            docs: list[Document] = []
            for hit in hits:
                title = hit.get("title")
                if not title:
                    continue
                # Step 2: fetch the article extract for that title
                extract = await http_get_with_retry(
                    client,
                    "https://en.wikipedia.org/w/api.php",
                    params={
                        "action": "query",
                        "prop": "extracts",
                        "explaintext": "1",
                        "titles": title,
                        "format": "json",
                        "redirects": "1",
                    },
                )
                if extract is None:
                    continue
                try:
                    pages = extract.json().get("query", {}).get("pages", {})
                except ValueError:
                    continue
                for _, page in pages.items():
                    text = (page.get("extract") or "").strip()
                    if not text:
                        continue
                    docs.append(
                        Document(
                            source=self.name,
                            source_url=f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
                            title=title,
                            text=text,
                            fetched_at=now_iso(),
                            extra={"pageid": page.get("pageid")},
                        )
                    )

        log_fetch(self.name, query, ok=bool(docs), count=len(docs))
        return docs
