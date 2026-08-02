"""Common Crawl source — HONEST STUB.

Why this is a stub:
  Common Crawl is petabytes of WARC archives. A real "fetch query → relevant
  pages" pipeline requires the CC Index Server (CDX API) for URL lookups,
  followed by ranged S3 reads of WARC files for the page bytes. That is a
  multi-day engineering project on its own (rate limits, CDX availability,
  WARC parsing, dedup, language filtering, robots compliance) and the result
  is open-web noise that needs aggressive ranking.

What this stub does:
  * Performs a real CDX URL existence query against the public index so the
    "is the source reachable" check actually exercises the network.
  * Returns at most one Document — a metadata-only record naming the CDX hits
    found — so the rest of the pipeline can see "common_crawl participated"
    without us ever fabricating content.
  * Carries authority weight 0.35 in config, the lowest in the system, so
    even when a real version ships, the rectifier won't let CC override
    Wikipedia/arXiv on contested claims.

When you're ready, swap _cdx_lookup with a real WARC fetcher.
"""

from __future__ import annotations

from .base import Document, http_get_with_retry, log_fetch, make_client, now_iso

# Latest stable CDX endpoint — the index name changes monthly; this default
# can be overridden via the constructor.
DEFAULT_INDEX = "CC-MAIN-2024-51-index"


class CommonCrawlSource:
    name = "common_crawl"

    def __init__(self, index: str = DEFAULT_INDEX) -> None:
        self.index = index

    async def fetch(self, query: str, *, limit: int = 5) -> list[Document]:
        async with make_client() as client:
            # The CDX API is built for URL/domain lookups, not text search.
            # We probe with the query as a URL fragment — this confirms
            # connectivity and returns SOME hits when the query happens to
            # resemble a domain or path.
            url = f"https://index.commoncrawl.org/{self.index}"
            resp = await http_get_with_retry(
                client,
                url,
                params={"url": f"*.{query.replace(' ', '')}*", "limit": "5", "output": "json"},
            )

        hit_count = 0
        if resp is not None and resp.text.strip():
            # Each line is a JSON record; just count them
            hit_count = sum(1 for line in resp.text.splitlines() if line.strip())

        note = (
            "stub: CDX probe only — no WARC content fetched. "
            "See module docstring for upgrade path."
        )
        log_fetch(self.name, query, ok=resp is not None, count=hit_count, note=note)

        # Return a single honest metadata document so the rest of the pipeline
        # sees the source participated, but with no fabricated content.
        return [
            Document(
                source=self.name,
                source_url=url,
                title=f"Common Crawl probe — {query}",
                text=(
                    f"Common Crawl CDX index '{self.index}' was probed for the query "
                    f"'{query}' and reported {hit_count} URL match(es). No page text "
                    f"was retrieved in this version of the source — see module "
                    f"docstring for the WARC-fetch upgrade path."
                ),
                fetched_at=now_iso(),
                extra={"index": self.index, "hits": hit_count, "stub": True},
            )
        ]
