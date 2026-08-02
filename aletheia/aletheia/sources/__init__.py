"""All five sources, ready for the orchestrator."""

from __future__ import annotations

from .arxiv import ArxivSource
from .base import Document, Source
from .common_crawl import CommonCrawlSource
from .gutenberg import GutenbergSource
from .open_library import OpenLibrarySource
from .wikipedia import WikipediaSource


def all_sources() -> list[Source]:
    """Return one instance of every source. Order is irrelevant."""
    return [
        WikipediaSource(),
        ArxivSource(),
        GutenbergSource(),
        OpenLibrarySource(),
        CommonCrawlSource(),
    ]


__all__ = [
    "Document",
    "Source",
    "WikipediaSource",
    "ArxivSource",
    "GutenbergSource",
    "OpenLibrarySource",
    "CommonCrawlSource",
    "all_sources",
]
