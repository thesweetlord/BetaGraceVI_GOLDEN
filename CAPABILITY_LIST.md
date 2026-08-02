# BetaGrace vI — Capability List
*Updated August 2, 2026 — reflects current codebase (v4.2)*

---

## 1. AI Modes (8 total)

| Mode | Description |
|---|---|
| **Standard** | Balanced writing assistant for everyday use |
| **Flesh Architect** | Dark, intense, body-horror and gothic creative writing |
| **Sanctuary** | Safe, gentle, protective tone for sensitive or emotional topics |
| **Advanced Reasoning** | Deep structured thinking for hard problems |
| **Autonomous** | Multi-step task execution — works independently without prompting |
| **Video Generator** | Generates cinematic storyboards, queues frame generation, assembles MP4 via FFmpeg |
| **Code Graph** | Analyzes pasted JS/TS/Python code and renders a live SVG force-directed dependency graph |
| **Academic Research** | Full 70×7 pipeline — Guard Loop validates topic, then writes a 7-section academic paper independently, section by section, in the background |

---

## 2. Smart Toggles

- **Faith Enhancement** — adds grace, spiritual voice, and warm faith-based imagery to responses
- **Advanced Reasoning** — enables deeper, more deliberate thinking with structured analysis

---

## 3. AI Provider Chain

All text generation cascades through providers until one succeeds:

1. **OpenRouter** — primary, fastest
2. **Local Synthesis Engine** — final fallback, always available, fully offline, and now powered by seed-first knowledge synthesis, a structured knowledge-lens response layer, and feedback-aware heuristics for more coherent answers without external APIs

Image generation uses Pollinations Flux API and does not require a paid key.

The platform works end-to-end without any paid API keys.

---

## 4. 70×7 Academic Artifact Builder

- Triggered by typing `/full [topic]` in chat or clicking the **Write Artifact** button in Academic Research mode
- **DuckDuckGo Guard Loop** validates the topic before any writing begins
- **Background job pattern** — POST returns a `jobId` in under 1 second; no proxy timeout issues
- **Live progress polling** — client polls every 3 seconds; progress bar shows `Section X/7 — <section title>`
- **7-section paper** written independently: Introduction, Literature Review, Theoretical Framework, Research Objectives, Methodology, Results, Conclusion
- Each section uses a 900-token budget with its own AI call
- Completed paper **downloads as a Markdown file**
- Artifacts persisted to PostgreSQL (`artifacts` table) — survive server restarts

---

## 5. Chat Memory

- Conversation history (last N messages) included in every prompt for contextual continuity
- Per-session **parallel learning engine** analyzes writing patterns in real time
- **Long-term semantic compression** stores insights across sessions
- Memory persists across server restarts via PostgreSQL
- Session history capped at 150 messages (configurable)

---

## 6. Knowledge & Learning System

- All user patterns, preferences, and learned insights stored in PostgreSQL (`learning_data`, `long_term_memory` tables)
- Parallel learning coordinator aggregates and compresses patterns continuously
- **Local synthesis stack** — uses foundational seed knowledge, supporting memory, and feedback-aware heuristics to produce grounded offline responses with better coherence and less memory-jumbling
- **Anti-cascade protocol**: learning data uses `ON DELETE SET NULL` — preserved even after session deletion
- Admin metrics available at `GET /api/health/learning` (requires `ADMIN_TOKEN`)
- Per-session isolation — one user's patterns never influence another session

---

## 7. Image Generation

- **Provider:** Pollinations Flux API — no key required for basic use
- **42 mix-and-match style descriptors** with layered composition and modifier system (150+ effective combinations)
- **High / Ultra quality** options
- **Advanced image routes** include hand-validation loop with up to 3 auto-retries for anatomical correctness
- URL-based generation — no binary upload required

---

## 8. Video Generation Pipeline

- Queues jobs asynchronously — returns `jobId` immediately, client polls for progress
- **10–20 unique cinematic scenes** (default 15) generated from progressive AI storyboard prompts
- Each scene has unique: shot angle, lighting, atmosphere, color palette, and cryptographically random seed
- **Real-time storyboard preview** with scene captions while frames are generating
- **FFmpeg assembly** — frames stitched into MP4 (H.264, libx264, CRF 23, fast preset)
- **Streaming delivery** via `GET /api/video/:filename` with range-request support
- **Automatic cleanup** of temp frames after assembly
- Fully supported on desktop and mobile (iOS + Android)

---

## 9. Code Graph Panel

- Paste any JS, TypeScript, or Python code snippet
- Parser extracts imports, exports, function calls, and class relationships
- **SVG force-directed graph** renders live in the browser using Graphology
- Nodes = files, classes, and functions; edges = dependency relationships
- Supports large codebases — zoom and pan on desktop and mobile

---

## 10. Safety & Guardrails

- **18+ age verification gate** (COPPA-compliant) — enforced on every authenticated request
- **4-layer content guardrail system** — perimeter defense, content filtering, jailbreak detection, injection blocking
- Prompt injection attempts blocked and sanitized
- Oversized messages rejected (400) before reaching AI provider
- Rate limiting (100 requests per 60 seconds per session)
- Concurrency limiter (1,000 simultaneous requests max)
- Request timeout enforcement (120s)

---

## 11. Privacy & Data Compliance

### GDPR Article 20 — Right to Data Portability
- **Full ZIP export** — `GET /api/privacy/export-data/zip` streams a compressed ZIP containing 6 JSON files + README:
  - `session.json`, `conversations.json`, `messages.json`, `consent.json`, `learning_data.json`, `long_term_memory.json`
  - `README.txt` explaining each file and citing GDPR Article 20
- **JSON export** — `GET /api/privacy/export-data` returns all 6 data types in a single JSON object
- One-click download from Settings → Data tab

### GDPR Article 17 — Right to Erasure
- **Deletion request form** — Settings → Data tab with reason dropdown + optional message field
- Request logged to `deletion_requests` database table with timestamp and session ID
- **Email notification** to administrator via configurable SMTP (nodemailer) — graceful fallback when unconfigured
- Admin panel shows all pending requests with one-click **Mark Complete / Processing / Failed** buttons
- Duplicate-request prevention (409 if pending request already exists)
- Status visible to user: Pending / In Progress / Completed

### Immediate Self-Service Deletion (Art. 17 instant)
- **Hard-delete** — `POST /api/privacy/delete-data` removes all session data via cascade immediately
- One-click from Settings → Data tab ("Delete All My Data")

### Additional Compliance Features
- **30-day rolling retention** — enforced on server startup and every 24 hours via `purgeExpiredSessions(30)`
- **12-month consent purge** — `purgeExpiredConsents(12)` enforced daily
- **6-category cookie consent** with granular opt-in/out
- **Data retention opt-out** flag per session
- Full [Privacy Policy](./PRIVACY_POLICY.md) and [Terms of Service](./TERMS_OF_SERVICE.md) served as API endpoints
- COPPA-compliant 18+ age verification gate on all authenticated routes

---

## 12. Session & Auth System

- Session fingerprinting: `X-Session-ID` header → cookie → `UA + IP + date` hash fallback
- Sessions auto-restore on reconnect without requiring login
- Per-session isolation — conversations, memory, and settings never bleed between sessions
- Duplicate session creation is idempotent (safe to call twice)

---

## 13. Admin Panel (in-app)

Access via Settings → Admin tab with `ADMIN_TOKEN`:

| Panel | Function |
|---|---|
| **Learning Health Dashboard** | Live counts: total learning rows, active vs. preserved (detached), long-term memory stats. Auto-refreshes every 30s |
| **GDPR Deletion Requests** | Full table of all Article 17 requests with session IDs, timestamps, user messages. One-click Mark Complete / Processing / Failed |
| **Session Consent Lookup** | Look up any session's consent record, acknowledgement timestamps, and cookie preferences by session ID |

All panels require `X-Admin-Token` header — 401 on any invalid/missing token.

---

## 14. Backend Reliability

- PostgreSQL persistence for all critical data (10 tables, all cascade-delete from sessions)
- In-memory stores for ephemeral data (video jobs, artifact jobs) with TTL purge
- Graceful fallback responses at every AI layer — the platform never hard-crashes on provider failure
- TypeScript strict mode — zero compilation errors
- 72-test smoke suite validates every critical path on every change
