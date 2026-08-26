# BetaGrace vI
(https://github.com/thesweetlord/BetaGraceVI_GOLDEN)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/smoke%20tests-76%2F78%20passing-yellow)  
**BetaGrace vI** is a full-stack AI agent platform designed for adult creative writing, multi-modal generation (text, image, video), and deep narrative exploration. Built on TypeScript, React, Express, and PostgreSQL — runs entirely on free-tier AI providers.

**Current Version:** 4.3 — May 27, 2026
**Test Status:** `npm run test:fast` — 76/78 smoke tests passing (97.4%); 2 local-synthesis debug retrieval checks currently return 401 Unauthorized.

## Image Generation Benchmark

### High-Density Constraint-Locking Evaluation

**20 / 27 canonical concepts passed (81.5%)** under strict zero-tolerance visual verification.

This public benchmark tests whether an image-generation system can hold a dense set of precise, verifiable constraints at once, including laterality, exact text placement and material, dual lighting temperatures, micro-details, and object states. One missing or unverifiable critical constraint is a **FAIL**; aspect ratio is excluded from the pass/fail metric.
This document is subject to change and scrutiny. I am only one developer.

The result applies to the documented prompts, endpoints, attempt budgets, and visual verification rules. It does not claim that the underlying image model was modified or retrained, universal superiority across prompts or model versions, or statistical dominance from the small head-to-head sample.

**Benchmark package:** IMAGE BENCHMARK.zip [README](IMAGE%20BENCHMARK/README.txt) · [master report](IMAGE%20BENCHMARK/BetaGrace_Benchmark_Master_Report_v2_5_Corrected.docx) · [27-prompt table](IMAGE%20BENCHMARK/BetaGrace_27_Canonical_Prompt_Table.xlsx) · [passing images](IMAGE%20BENCHMARK/Passes/) · [failed images](IMAGE%20BENCHMARK/Fails/) · [public image logs](IMAGE%20BENCHMARK/Public_image_logs_for_Postgresql_CLEAN.zip)

---

## What is BetaGrace?

BetaGrace is an AI agent platform with 8 specialized writing modes, a cinematic video generation pipeline, a 7-section academic paper builder, image generation with 42 mix-and-match style descriptors, code graph intelligence, a full GDPR compliance layer (Art. 17 + Art. 20), and an in-app admin dashboard — all running as a single self-contained server you can deploy anywhere.

It runs entirely on free-tier AI providers (OpenRouter + Local Synthesis). No paid API keys are required to get started.

---

## Features

### 8 AI Modes

| Mode | Description |
|---|---|
| **Standard** | Balanced writing and general-purpose assistant |
| **Flesh Architect** | Dark, intense, body-horror and gothic creative writing |
| **Sanctuary** | Safe, gentle, protective tone for sensitive topics |
| **Advanced Reasoning** | Deep structured thinking for complex questions |
| **Autonomous** | Multi-step task execution without hand-holding |
| **Video Generator** | Cinematic storyboard → frame generation → FFmpeg MP4 assembly |
| **Code Graph** | Paste code → live SVG force-directed dependency graph (JS/TS/Python) |
| **Academic Research** | 70×7 pipeline: Guard Loop → 7-section paper, written and downloaded independently |

### Smart Toggles
- **Faith Enhancement** — adds spiritual voice and grace-forward imagery to responses
- **Advanced Reasoning** — deeper, structured thinking in any mode

### AI Provider Chain (fully free)
Requests cascade through providers until one succeeds:
1. **OpenRouter** — primary, fastest
2. **Local Synthesis Engine** — always available, zero external dependencies

### 70×7 Academic Artifact Builder
- Type `/full [topic]` in chat or click the Write Artifact toolbar button
- DuckDuckGo Guard Loop validates the topic before any writing begins
- 7-section paper generated in the background — no proxy timeouts
- Live progress bar: Section X/7 — `<current section title>` updated every 3 seconds
- Completed paper downloads as a Markdown file
- Artifacts persisted to PostgreSQL — survive server restarts

### Video Generation Pipeline
- Storyboard hydration engine generates 10–20 cinematically distinct scenes
- Each frame individually prompted with unique shot angles, lighting, atmosphere, and seed
- FFmpeg assembles frames into a streaming MP4 (H.264, CRF 23, fast preset)
- Real-time storyboard preview with scene captions during processing
- Automatic cleanup of temp frames after assembly
- Full mobile support (iOS + Android)

### Image Generation
- Pollinations Flux API — no key required for basic use
- **42 mix-and-match style descriptors** — 150+ effective style combinations
- Hand-validation loop with up to 3 auto-retries for anatomical correctness
- High / ultra quality options

### Code Graph Panel
- Paste any JS, TypeScript, or Python snippet
- SVG force-directed graph renders live in the browser using Graphology
- Nodes = files/classes/functions, edges = import/call relationships
- Works on mobile (pinch-zoom recommended for large graphs)

### Memory & Learning System
- Per-session parallel learning engine analyzes writing patterns in real time
- Long-term semantic compression stores insights across sessions
- Anti-cascade protocol: learning data survives session deletion (`ON DELETE SET NULL`)
- All memory stored in PostgreSQL — persists across restarts
- Admin endpoint: `GET /api/health/learning` (requires `ADMIN_TOKEN`)
- Retrieval debug endpoint: `POST /api/synthesis/test-retrieval` lets you inspect the top local BM25/fallback matches and scores without affecting normal chat behavior

### Privacy & GDPR Compliance

**GDPR Article 20 — Right to Data Portability**
- One-click ZIP export from Settings → Data tab — 6 JSON files + README.txt
- Files: `session.json`, `conversations.json`, `messages.json`, `consent.json`, `learning_data.json`, `long_term_memory.json`

**GDPR Article 17 — Right to Erasure**
- Formal deletion request form in Settings → Data tab (reason + optional message)
- Request logged to DB, admin email notification via configurable SMTP
- 30-day processing window with status tracking (pending → processing → completed)

**Instant Self-Service Deletion**
- "Delete All My Data" button hard-deletes everything immediately via cascade

**Additional**
- COPPA-compliant 18+ age verification gate
- 30-day rolling retention auto-purge (based on last interaction, not session creation)
- 12-month consent record auto-purge
- 6-category granular cookie consent
- Full Privacy Policy and Terms of Service served as API endpoints

### In-App Admin Panel

Access via Settings → Admin tab with your `ADMIN_TOKEN`:

| Panel | Function |
|---|---|
| **Learning Health Dashboard** | Live DB counts for learning data, long-term memory, anti-cascade proof. Auto-refreshes every 30s |
| **GDPR Deletion Requests** | All Art. 17 requests with session IDs, timestamps, user messages. One-click Mark Complete / Processing / Failed |
| **Session Consent Lookup** | Look up any session's consent record and cookie preferences by session ID |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + Vite + TypeScript |
| **Styling** | Tailwind CSS + shadcn/ui (Radix UI) |
| **State** | Zustand + TanStack Query |
| **Backend** | Express + TypeScript (tsx) |
| **Database** | PostgreSQL 14+ via Drizzle ORM |
| **AI / Text** | OpenRouter + Local Synthesis |
| **AI / Images** | Pollinations Flux API |
| **Video** | FFmpeg (ffmpeg-static, no install required) |
| **Email** | nodemailer (SMTP — optional, graceful skip when unconfigured) |
| **Auth** | Session-based with fingerprint fallback |
| **Routing** | Wouter (client), Express (server) |

---

## Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 14+ (or a free hosted instance — Neon, Supabase, Railway)

### 1. Clone & install

```bash
git clone https://github.com/thesweetlord/BetAGracevI.git
cd betagrace
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` — the three required values:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/betagrace
SESSION_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
ADMIN_TOKEN=<Set by Admin/User>
DEV_PASSWORD=<Set by Admin/User>
```

Everything else is optional. The app works fully without any paid API keys.

**Optional — for better AI performance:**
```env
POLLINATIONS_API_KEY=your_key_here
```

**Optional — for GDPR Art. 17 email alerts:**
```env
ADMIN_EMAIL=admin@yourdomain.com
SMTP_FROM=noreply@yourdomain.com
SMTP_HOST=smtp.yourdomain.com
SMTP_PORT=587
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
```

### 3. Set up the database

```bash
npx drizzle-kit push
```

### 4. Start the server

```bash
npm run dev
```

Open `http://localhost:5000` — you'll see the age verification screen, then the full platform.

---

## Running Tests

```bash
# Fast mode (78 tests, ~23s) — skips long-polling artifact waits
npm run test:fast

# Full suite (includes artifact polling and may take several minutes)
npm run test
```

The fast suite covers: all 8 AI modes, full session lifecycle, SSE streaming, artifact builder pipeline, video mode guards, code graph analysis, memory system, guardrails (injection + oversized message), privacy endpoints (export/delete/anti-cascade), admin token auth, GDPR flows, feature toggles, concurrent session isolation, session edge cases, max-token validation, and database schema checks. The current run passes 76 of 78 checks; the two failures are local-synthesis debug retrieval checks receiving `401 Unauthorized`.

---

## Project Structure

```
betagrace/
├── client/                              # React + Vite frontend
│   └── src/
│       ├── components/
│       │   ├── ChatInterface.tsx        # Main chat UI (~2,050 lines)
│       │   ├── CodeGraphPanel.tsx       # SVG code graph renderer
│       │   ├── ModeSelector.tsx         # AI mode switcher
│       │   └── ...
│       └── pages/
│           ├── Dashboard.tsx            # Main app page
│           └── Settings.tsx             # Settings + Admin panel (1,399 lines)
├── server/
│   ├── routes.ts                        # All API endpoints (6,659 lines)
│   ├── ai.ts                            # Multi-provider AI orchestration
│   ├── academic-research-engine.ts      # 70x7 Artifact Builder + Guard Loop
│   ├── guardrails.ts                    # Content safety layer (1,175 lines)
│   ├── storage.ts                       # Data access layer (1,133 lines)
│   ├── email.ts                         # SMTP email service (GDPR Art. 17)
│   ├── video-engine-hydration.ts        # Storyboard + scene hydration
│   ├── synthesis-engine.ts              # Memory synthesis system
│   ├── parallel-learning.ts             # Behavioral pattern engine
│   └── code-graph-analyzer.ts          # JS/TS/Python graph builder
├── shared/
│   └── schema.ts                        # Drizzle ORM schema (10 tables)
├── smoke-tests.ts                       # Integration smoke-test suite
├── BETAGRACE_REPORT.md                  # Full technical & operational report
├── CAPABILITY_LIST.md                   # Feature reference
├── compatibility-list.md                # Browser, Node, DB, email compatibility
├── CHANGELOG.md                         # Version history
├── CONTRIBUTING.md                      # Setup guide for contributors
└── .env.example                         # All environment variables documented
```

---

## API Overview

### Session
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/session` | Create or retrieve session |
| `POST` | `/api/session/verify-age` | Set 18+ verification flag |
| `GET` | `/api/session/status` | Get current session state |

### Chat
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat` | Send message — all 8 modes supported |
| `GET` | `/api/chat/stream` | SSE streaming chat |

### Academic Artifact Builder
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/academic/artifact/build` | Start 70×7 job → `{jobId}` in <1s |
| `GET` | `/api/academic/artifact/status/:jobId` | Poll build progress |

### Image & Video
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/generate-image` | Generate image |
| `POST` | `/api/video` | Queue video generation job |
| `GET` | `/api/video-status/:jobId` | Poll video job status |
| `GET` | `/api/video/:filename` | Stream completed MP4 |

### Privacy (GDPR)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/privacy/export-data` | Export full session JSON (Art. 20) |
| `GET` | `/api/privacy/export-data/zip` | Download ZIP archive (Art. 20) |
| `POST` | `/api/privacy/delete-data` | Hard-delete session + all data instantly |
| `POST` | `/api/privacy/deletion-request` | Submit formal Art. 17 erasure request |
| `GET` | `/api/privacy/deletion-request` | Get current session's request status |

### Admin (requires `X-Admin-Token` header)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health/learning` | Learning system metrics |
| `GET` | `/api/admin/deletion-requests` | List all Art. 17 requests |
| `PATCH` | `/api/admin/deletion-requests/:id` | Update request status |
| `GET` | `/api/admin/consent-audit` | Session consent lookup |

### Synthesis / Local Memory Debug
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/synthesis/stats` | Live BM25/local synthesis engine stats |
| `POST` | `/api/synthesis/test-retrieval` | Read-only debug: inspect top retrieved memory records + scores for a query |
| `POST` | `/api/synthesis/distill` | Force a distillation pass (prune + reindex) |

Example retrieval debug request:

```bash
curl -X POST http://localhost:5000/api/synthesis/test-retrieval \
  -H "Content-Type: application/json" \
  -d '{
    "userMessage": "how does the admin panel memory system work?",
    "systemPrompt": "You are BetaGrace vI in STANDARD mode.",
    "mode": "standard",
    "k": 5
  }'
```

This endpoint is **read-only**. It does not generate chat output, mutate sessions, or change stored memories. It only shows which local memory records the synthesis engine would retrieve and how they scored.

### Health
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Server + DB health check |
| `GET` | `/api/privacy-policy` | Full privacy policy text |
| `GET` | `/api/terms-of-service` | Full terms of service text |

Full API reference: see `BETAGRACE_REPORT.md`

---

## Security

- 8-layer middleware stack (CORS, body limit 50kb, security headers, HTTPS enforce, cache-control, concurrency limiter 1,000 req, 120s timeout, rate limiter 100 req/60s)
- 4-layer guardrail system (perimeter defense, age check, jailbreak detection, content filtering)
- `ADMIN_TOKEN` ships blank — forks cannot use a preset default
- `DEV_PASSWORD` ships blank — `/api/dev/push-to-code` disabled in production
- Zero hardcoded credentials anywhere in source

---

## Contributing

See `CONTRIBUTING.md` for the full setup guide and PR process.

---

## License

BetaGrace vI is free software released under the **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**.
Copyright (C) 2026 Jesse J. Wheeler Jr.

You may use, modify, and distribute this software under the terms of the AGPL-3.0. Any derivative work or hosted service built on BetaGrace must also be released under the same license. See the [LICENSE](LICENSE) file for the full text.
