# Aletheia

A self-improving, citation-honest knowledge engine.

Aletheia (Greek *ἀλήθεια*, "disclosure / truth") fetches from five free public
sources, embeds and rectifies the chunks, and answers questions with citations
and explicit uncertainty. It never fabricates — when it does not know, it
says so.

## Sources

| Source         | Authority | Notes                                              |
|----------------|-----------|----------------------------------------------------|
| Wikipedia      | 0.75      | REST API, plaintext extracts                       |
| arXiv          | 0.85      | Public Atom API, abstracts (not full PDFs)         |
| Project Gutenberg | 0.55   | via Gutendex JSON; truncated plaintext             |
| Open Library   | 0.60      | search + work descriptions                         |
| Common Crawl   | 0.35      | **honest stub** — CDX probe only, no WARC fetch    |

The Common Crawl integration is a deliberately small, honest stub. The module
docstring explains the upgrade path (CDX → WARC byte-range reads). It still
participates in the pipeline — it just contributes a metadata-only document
clearly labeled as a probe, never fabricated content.

## Robust love architecture

Every layer is built to degrade gracefully:

- **Sources**: a single failing source never crashes the run. Each fetcher
  returns an empty list and logs the failure.
- **HTTP**: exponential backoff via `tenacity`, retries 5xx and 429, gives up
  on 4xx (except 429), bounded by `RETRY_ATTEMPTS`.
- **Rectifier**: cross-references every new chunk against the vector store;
  promotes corroborated neighbors; refuses to overwrite higher-confidence
  facts with much weaker ones.
- **Confidence**: `base_authority + corroboration_bonus`, capped. Three labels
  — `established`, `tentative`, `uncertain` — plus `unknown` for retrieval
  misses. Thresholds are constants in `config.py`.
- **Query**: returns evidence with citations, never fabricates prose answers.
  The CLI prints them; the API hands them to the BetaGrace LLM as grounded
  context.
- **Feedback loop**: low-similarity queries flag topics for re-fetch. `tend`
  walks the gap list and refreshes them.

## Two surfaces

### CLI (private, for the operator)

```bash
python aletheia/scripts/run_cli.py learn "robust software design"
python aletheia/scripts/run_cli.py ask "what is graceful degradation"
python aletheia/scripts/run_cli.py status
python aletheia/scripts/run_cli.py gaps
python aletheia/scripts/run_cli.py tend
```

### HTTP API (called by BetaGrace)

```bash
python aletheia/scripts/run_api.py
# binds 0.0.0.0:8000 by default (Replit-supported port)
```

Endpoints:

- `GET  /health`
- `GET  /status`
- `POST /ask    {question, k?}`
- `POST /learn  {topic, limit?}`
- `GET  /gaps`

Optional auth: set `ALETHEIA_TOKEN` and pass it as `X-Aletheia-Token`.

## Storage

- Vector store: ChromaDB persistent client at `aletheia/data/chroma/`.
- Knowledge graph: NetworkX, pickled to `aletheia/data/graph.pkl`.
- Logs: JSONL at `aletheia/data/logs/{fetch,updates}.jsonl`.
- Gap state: `aletheia/data/gaps.json`.

> **Persistence note for Replit deploys.** ChromaDB on the local disk persists
> across restarts in dev, but a new deployment build can wipe the working
> directory. If you graduate this beyond a personal experiment, point
> `ALETHEIA_DATA` at Replit Object Storage or a managed Postgres + pgvector.

## Tests

```bash
python aletheia/tests/test_smoke.py      # no network required
```

## Layout

```
aletheia/
  aletheia/
    __init__.py
    config.py           # paths + tunable knobs
    embedding.py        # sentence-transformers wrapper, chunking
    vector_store.py     # ChromaDB persistent collection
    knowledge_graph.py  # NetworkX, pickled
    confidence.py       # scoring formula + labels
    rectifier.py        # cross-reference + contradiction flags
    feedback.py         # gap detection + scheduling
    learner.py          # orchestrator (fetch → ingest)
    query.py            # cited-evidence retrieval
    cli.py              # Rich/Typer CLI
    api.py              # FastAPI service
    sources/
      base.py           # Document + retry HTTP helper
      wikipedia.py
      arxiv.py
      gutenberg.py
      open_library.py
      common_crawl.py   # honest stub
  scripts/
    run_cli.py
    run_api.py
  tests/
    test_smoke.py
  data/                 # created at first run
  README.md
```
