# BetaGrace — a multistack AI Agent, a sophisticated API wrapper with 8 modes.
# Copyright (C) 2026  Jesse James Wheeler Jr.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

"""Central config — paths, knobs, source-authority weights.

Tweak SOURCE_AUTHORITY when you have empirical evidence one source is more
reliable than another. Tweak MIN_CROSS_SOURCES upward to be stricter, downward
to admit more knowledge faster.
"""

from __future__ import annotations

import os
from pathlib import Path

# ────────────────────────────────────────────────────────────────────────────
# Paths
# ────────────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("ALETHEIA_DATA", ROOT / "data"))
CHROMA_DIR = DATA_DIR / "chroma"
GRAPH_PATH = DATA_DIR / "graph.pkl"
LOG_DIR = DATA_DIR / "logs"
FETCH_LOG = LOG_DIR / "fetch.jsonl"
UPDATE_LOG = LOG_DIR / "updates.jsonl"
GAPS_PATH = DATA_DIR / "gaps.json"

for d in (DATA_DIR, CHROMA_DIR, LOG_DIR):
    d.mkdir(parents=True, exist_ok=True)

# ────────────────────────────────────────────────────────────────────────────
# Embedding model — small, fast, decent quality, ~90 MB
# ────────────────────────────────────────────────────────────────────────────
EMBEDDING_MODEL = os.environ.get(
    "ALETHEIA_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
)
EMBEDDING_DIM = 384  # all-MiniLM-L6-v2 produces 384-dim vectors

# ────────────────────────────────────────────────────────────────────────────
# Source authority — used in confidence scoring.
# 0.0–1.0. Higher = more trustworthy by default.
# Wikipedia/arXiv lead because they have visible review/edit trails;
# Gutenberg/Open Library are primary-source-rich but less curated for facts;
# Common Crawl is open-web noise without per-page curation.
# ────────────────────────────────────────────────────────────────────────────
SOURCE_AUTHORITY: dict[str, float] = {
    "wikipedia": 0.75,
    "arxiv": 0.85,
    "gutenberg": 0.55,
    "open_library": 0.60,
    "common_crawl": 0.35,
    "web": 0.30,
    "knowledge_dump": 0.30,
}

# ────────────────────────────────────────────────────────────────────────────
# Rectification thresholds
# ────────────────────────────────────────────────────────────────────────────
# A claim must agree with at least this many DISTINCT sources to be promoted
# to "established" confidence.
MIN_CROSS_SOURCES = 3

# Cosine similarity above which two embeddings are treated as the same claim.
SIMILARITY_THRESHOLD = 0.78

# Confidence below this is reported as "uncertain" — never fabricated as fact.
UNCERTAIN_BELOW = 0.45

# Confidence at/above this is reported as "established".
ESTABLISHED_AT = 0.75

# Never overwrite a stored fact whose confidence is higher than the incoming
# confidence by more than this margin.
OVERWRITE_GUARD = 0.15

# ────────────────────────────────────────────────────────────────────────────
# Fetcher settings
# ────────────────────────────────────────────────────────────────────────────
HTTP_TIMEOUT_S = 30.0
HTTP_USER_AGENT = (
    "AletheiaBot/0.1 (self-improving knowledge engine; "
    "respects robots.txt and rate limits; https://github.com/thesweetlord/BetAGracevI)"
)
MAX_CONCURRENT_FETCHES = 4
RETRY_ATTEMPTS = 4
RETRY_BACKOFF_BASE_S = 1.5

# Chunking
CHUNK_TARGET_CHARS = 1_200
CHUNK_OVERLAP_CHARS = 150

# ────────────────────────────────────────────────────────────────────────────
# Feedback loop
# ────────────────────────────────────────────────────────────────────────────
RE_EMBED_AFTER_POOR_QUERIES = 3  # flag a topic if N queries return weak results
WEAK_RESULT_TOP1_SIM = 0.55  # below this, top-1 result is "weak"
