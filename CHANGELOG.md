# Changelog

All notable changes to BetaGrace are documented here.

---

## [BetaGrace vI — Public Open-Source Release] — 2026-06-03

This release prepares BetaGrace vI for public open-source distribution on GitHub under the GNU Affero General Public License v3.0.

### License

- Adopted **AGPL-3.0-or-later** as the project license
- Added AGPL-3.0 license header block to all 8 primary source files:
  `server/index.ts`, `server/routes.ts`, `server/ai.ts`, `client/src/main.tsx`, `client/src/App.tsx`, `main.py`, `main_pipeline.py`, `aletheia/aletheia/config.py`
- Updated `package.json` `"license"` field from `"MIT"` to `"AGPL-3.0-or-later"`
- `LICENSE` file (full AGPL-3.0 text) added to repository root

### Branding

- Corrected all instances of `BetaGrace Inc` / `BETAGRACE INC` → `BetaGrace` across 7 files:
  `TERMS_OF_SERVICE.md`, `PRIVACY_POLICY.md`, `server/routes.ts`, `client/src/lib/constants.ts`, `client/src/components/AgeVerificationModal.tsx`, `smoke-tests.ts`, `BETAGRACE_REPORT.md`

### Legal & Compliance

- **Removed all New Mexico-specific legal content** from every file it appeared in:
  - "Notice to New Mexico Residents" sections (rights, appeal, AG address/phone)
  - Governing law references to New Mexico courts and jurisdiction
  - `NM_ATTORNEY_GENERAL`, `NM_AG_ADDRESS`, `NM_AG_PHONE` constants removed from `client/src/lib/constants.ts`
  - Footer text in `Settings.tsx` and `UnderageNotice.tsx`
- **README license section** corrected — removed "All rights reserved" (contradicted AGPL-3.0); replaced with proper AGPL-3.0 attribution and summary

### Contact & Email Cleanup

- Removed all personal email addresses (`acekinghighcard@gmail.com`, `reppingtgod1@gmail.com`) from 7 files
- Replaced all remaining `your-email@example.com` placeholders in user-visible UI and config with GitHub repository links:
  - `AgeVerificationModal.tsx` — privacy contact now links to GitHub Issues
  - `UnderageNotice.tsx` — "Request Parental Consent" button now opens GitHub Issues (was `mailto:`)
  - `aletheia/aletheia/config.py` — HTTP user-agent contact field now links to GitHub repo
  - `client/src/lib/constants.ts` — removed `SUPPORT_EMAIL` / `LEGAL_EMAIL`; added `GITHUB_ISSUES_URL` constant
- `SECURITY.md` — removed email reporting channel; now directs reporters exclusively to GitHub Security Advisories

### Documentation

- **`CONTRIBUTING.md`** — added AGPL-3.0 contributor license agreement section at top:
  three-point agreement (original work, same license, usage grant) + both license header formats (TypeScript and Python) for new files
- **`SECURITY.md`** — updated vulnerability reporting instructions with step-by-step GitHub Security Advisory flow
- **`README.md`** — fixed clone URL (`YOUR_USERNAME/betagrace` → `thesweetlord/BetAGracevI`)
- **`CONTRIBUTING.md`** — fixed clone URL (`YOUR_USERNAME/betagrace` → `thesweetlord/BetAGracevI`)
- **Terms of Service contact section** in `server/routes.ts` — replaced email with GitHub discussion link

---

## [BetaGrace vI — v4.3] — 2026-05-27

### Admin Panel — Session Consent Search + GDPR Art. 17 Direct Delete

**Session Consent Activity panel — new capabilities (Settings → Admin tab)**
- **Search button** — partial ILIKE match on session ID, or leave blank to browse the 25 most recent sessions; results show in a compact table with session ID (click to expand detail), consent date, and age-verified badge
- **Delete button on every search result row** — inline two-step confirm (Delete → Confirm/Cancel) with per-button spinner; row is removed from the list on success
- **Delete Session Data section on detail card** — gated on non-null session ID; labeled with GDPR Art. 17 citation; auto-completes any pending/processing deletion requests for that session in the same transaction

**New backend route**
- `DELETE /api/admin/sessions/:sessionId` — requires `X-Admin-Token`; hard-deletes all session data via cascade; atomically marks any `pending`/`processing` Art. 17 deletion requests as `completed`; logs action with GDPR citation
- `?session_id_search=` parameter added to `GET /api/admin/consent-audit` — parameterized ILIKE for partial session ID match; safe against SQL injection

**Bug fixes**
- Removed `session_id!` non-null assertions from admin delete buttons; delete section is now gated on `sessionConsentRecord.session_id !== null` — eliminates false-confirm risk for orphaned consent records
- SMTP transport crash vector fixed: `connectionTimeout: 10_000, socketTimeout: 15_000` added to nodemailer — prevents 2-minute HTTP freeze on unreachable SMTP server
- `getDeletionRequestBySession` in `MemStorage` now returns most-recent request regardless of status (was incorrectly filtering to `status === "pending"` only)

**Repo cleanup**
- Removed `zipFile.zip`, `attached_assets/betagrace-data-export-*`, and `attached_assets/Pasted-*.txt` from working tree (all covered by `.gitignore`)

---

## [BetaGrace vI — v4.2] — 2026-05-27

### GDPR Article 17 — Right to Erasure (Full Implementation)

**User-facing deletion request form (Settings → Data tab)**
- New orange-bordered card "Request Account Deletion" with GDPR Article 17 subtitle
- Reason dropdown (5 options: no longer using, privacy concerns, dissatisfied, legal requirement, other) + optional message textarea (1,000 char limit)
- Confirmation dialog before submission — prevents accidental requests
- Pending state: clock icon + "Pending Review" banner, 30-day GDPR deadline reminder, request ID for reference
- Completed state: green check + completion date
- Duplicate-request prevention: 409 returned if a pending request already exists for the session

**Admin deletion requests panel (Settings → Admin tab)**
- New "GDPR Deletion Requests" card — only visible after valid `ADMIN_TOKEN` authentication
- Live count badge showing number of pending + processing requests
- Per-request display: color-coded status badge (orange/blue/green/red), submission timestamp, session ID, message preview (first 120 chars)
- One-click **Mark Complete** button (green), **Mark Processing** button (blue, pending only), **Mark Failed** button (red)
- Inline loading spinner per button — prevents double-click race
- Refresh button to re-fetch without page reload
- Empty state with icon when no requests exist

**Backend API (all routes protected by `X-Admin-Token` / session auth)**
- `POST /api/privacy/deletion-request` — creates request, prevents duplicates (409), attempts email notification
- `GET /api/privacy/deletion-request` — returns most-recent request status for current session
- `GET /api/admin/deletion-requests` — admin-only: lists all requests newest-first
- `PATCH /api/admin/deletion-requests/:id` — admin-only: update status to `processing` / `completed` / `failed`

**Email notification service (`server/email.ts`)**
- New nodemailer-based service — sends formatted HTML + plain-text admin alert on every new deletion request
- Environment variables: `ADMIN_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- All variables default to blank — graceful skip when unconfigured (request still logged to DB, no crash)
- Email body includes: session ID, reason, optional message, submission timestamp, 30-day GDPR deadline

### GDPR Article 20 — ZIP Data Export

- New `GET /api/privacy/export-data/zip` endpoint streams a ZIP archive containing:
  - `session.json` — session metadata and settings
  - `conversations.json` — all conversation titles and timestamps
  - `messages.json` — full message history with AI provider metadata
  - `consent.json` — cookie consent record and timestamps
  - `learning_data.json` — per-session writing pattern data
  - `long_term_memory.json` — compressed semantic memory entries
  - `README.txt` — plain-English explanation citing GDPR Art. 20
- JSON export (`GET /api/privacy/export-data`) enriched to include all 6 data types (previously omitted `consent`, `learningData`, `longTermMemory`)
- One-click download button in Settings → Data tab

### Bug Fixes

- **`MemStorage.getDeletionRequestBySession`** — was incorrectly filtering to `status === "pending"` only, causing completed/failed requests to be invisible to the user-facing status endpoint. Fixed to return the most-recent request regardless of status (matching PgStorage behavior)
- **`IStorage.deleteAllUserData` / `exportUserData`** — `user_message` column added to `deletion_requests` table for storing optional user message with the request

### Database

- `deletion_requests` table: added `user_message TEXT` column (nullable) — stores the optional message field from the deletion request form

### Technology Stack

- Added `nodemailer` (^8.0.9) + `@types/nodemailer` — SMTP email notifications
- Added `archiver` (^8.0.0) + `@types/archiver` — ZIP archive generation for data export

### Test Results (May 27, 2026)

- TypeScript: **0 errors** (strict mode)
- Smoke tests: **72/72 PASSED** — 100% pass rate — 41.3s

---

## [BetaGrace vI] — 2026-05-23 — Current Release

This is the first public release of BetaGrace — renamed from the internal v4.0 tag to **BetaGrace vI** (Roman numeral I) to mark the start of open community development.

### Security Fixes (applied before public release)

- **CRITICAL REMOVED:** `@Westside505` was hardcoded as the password for `/api/dev/push-to-code` and `/api/dev/self-mend` in both `server/routes.ts` and `client/src/components/ChatInterface.tsx`. All three references replaced with `process.env.DEV_PASSWORD` — the server hard-refuses if `DEV_PASSWORD` is not set.
- **`/api/dev/push-to-code` now returns 404 in `NODE_ENV=production`** — a file-write endpoint must never be live in a production deployment.
- **Client-side password gate removed** — the browser-side password check in `ChatInterface.tsx` was comparing against the hardcoded string (visible in the compiled JS bundle). Replaced with a note that server-side `DEV_PASSWORD` is the real gate.
- **Smoke test password cleaned** — `smoke-tests.ts` now uses `process.env.DEV_PASSWORD` and skips gracefully if not set.
- **`.env.example` updated** — added `DEV_PASSWORD`, `RAG_ENABLED`, `SYNTHESIS_MEMORY_PATH` entries with documentation.
- **CI fixed** — replaced `npx wait-on` (not installed) with a native `curl` polling loop; added `DEV_PASSWORD` to CI env block.

### What's in vI

**Core Platform**
- Full-stack TypeScript + React + Express architecture on PostgreSQL
- 8 specialized AI modes: Standard, Flesh Architect, Sanctuary, Advanced Reasoning, Autonomous, Video Generator, Code Graph, Academic Research
- Real-time SSE streaming chat with token-by-token delivery
- Session-based auth with fingerprint fallback — no accounts required

**AI Provider Chain** (fully free, no paid keys required)
- Pollinations.ai (authenticated) → Pollinations.ai (anonymous) → HuggingFace Llama 3.1-8B → Local Synthesis Engine

**70×7 Academic Artifact Builder**
- DuckDuckGo Guard Loop validates topic before writing begins
- Background job pattern — POST returns `{jobId}` in <1s, no proxy timeouts
- Live section-by-section progress polling every 3s
- 7-section academic paper assembled and downloaded as Markdown
- `/full [topic]` chat shortcut

**Video Generation Pipeline**
- Multi-scene storyboard hydration engine (10–20 scenes)
- Per-frame Pollinations Flux image generation with unique seeds
- FFmpeg assembly → streaming MP4 delivery with range-request support
- Real-time storyboard preview during generation
- Full mobile support (iOS + Android)

**Image Generation**
- Pollinations Flux API — 150+ art styles
- Hand-validation retry loop (up to 3 retries)
- No API key required for basic use

**Code Graph Panel**
- SVG force-directed dependency graph for JS/TS/Python
- Renders in all modern browsers including mobile

**Memory & Learning System**
- Per-session parallel learning engine
- Long-term semantic compression across sessions
- Full PostgreSQL persistence

**Privacy & Compliance**
- COPPA-compliant 18+ age verification
- GDPR-aligned: 30-day rolling retention, hard-delete, data export
- 6-category cookie consent
- Full Privacy Policy and Terms of Service served as API endpoints

**Security**
- 8-layer middleware stack (CORS, body limit, security headers, rate limiting, concurrency, timeout)
- 4-layer guardrail system (perimeter, age, jailbreak detection, content filtering)
- 1,175-line guardrails engine
- ADMIN_TOKEN-protected metrics endpoint

**Testing & Tooling**
- 52/52 smoke tests — all critical paths, all modes, all edge cases
- Zero TypeScript errors (strict mode)
- GitHub Actions CI — runs on every push and PR
- Docker Compose for one-command local setup
- Makefile with common dev commands

**Community Files**
- `CONTRIBUTING.md` — setup guide, local dev, PR process
- `SECURITY.md` — vulnerability reporting and 8-layer architecture
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1
- Issue templates: bug report, feature request
- Pull request checklist template
- `CAPABILITY_LIST.md` — full feature reference
- `compatibility-list.md` — browser, Node, database, mobile compatibility
- `BETAGRACE_REPORT.md` — full technical and operational report

---

## Prior Internal Versions (pre-public)

### [4.0.0-internal] — 2026-05-22

- Background job + polling pattern for artifact builder (fixes proxy timeout bug)
- 52-test smoke suite (expanded from 34)
- `ADMIN_TOKEN` ships blank — forks cannot use a preset default
- `.gitignore` and `.env.example` fully corrected
- Dead code and unused imports removed

### [3.33.0-internal] — 2026-05-22

- Academic Research Mode added
- Artifact Builder panel: topic input, build trigger, Markdown download
- 7-section cap, 900-token budget per section
- `/full [topic]` chat command

### [3.0.0-internal] — 2026-05-22

- Initial full-stack implementation
- PostgreSQL schema: 9 tables, full cascade-delete
- All 8 AI modes
- Video pipeline, image generation, code graph
- Session auth, age gate, GDPR compliance layer
