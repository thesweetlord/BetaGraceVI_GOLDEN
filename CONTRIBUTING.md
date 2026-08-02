# Contributing to BetaGrace vI

Welcome, and thank you for your interest in BetaGrace vI. This guide gets you from zero to a fully running local instance in under 5 minutes.

---

## License Agreement

BetaGrace is licensed under the **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**.

By submitting a contribution (pull request, patch, or any code change) to this repository, you agree that:

1. Your contribution is your own original work, or you have the right to submit it.
2. Your contribution is submitted under the same AGPL-3.0-or-later license that governs this project.
3. You grant Jesse James Wheeler Jr. and all recipients of BetaGrace a perpetual, worldwide, non-exclusive, royalty-free license to use, reproduce, modify, and distribute your contribution as part of this project under the AGPL-3.0-or-later.

**All new source files you add must include the standard AGPL-3.0 license header at the very top.** See the formats below.

### License header — TypeScript / JavaScript / TSX / JSX

```ts
/*
 * BetaGrace — a multistack AI Agent, a sophisticated API wrapper with 8 modes.
 * Copyright (C) 2026  Jesse James Wheeler Jr.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
```

### License header — Python

```python
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
```

---

## What you need before starting

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **PostgreSQL 14+** — [postgresql.org](https://www.postgresql.org/download/) or a hosted database (Neon, Supabase free tier, Railway, etc.)
- **Python 3.11+** — only needed if you want to use the Python video pipeline scripts
- **FFmpeg** — installed automatically via the `ffmpeg-static` npm package; no manual install needed

---

## 1. Clone the repository

```bash
git clone https://github.com/thesweetlord/BetAGracevI.git
cd BetAGracevI
```

---

## 2. First-time setup (one command)

```bash
make setup
```

This installs all dependencies and pushes the database schema in one step. Run `make help` at any time to see every available command.

Alternatively, step by step:

```bash
npm install
npx drizzle-kit push
```

---

## 3. Set up environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

| Variable | How to get it | Required |
|---|---|---|
| `DATABASE_URL` | Your PostgreSQL connection string | Yes |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Yes |
| `ADMIN_TOKEN` | Run the same command above for a second value | Yes |
| `HF_TOKEN` | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) — free | Recommended |
| `POLLINATIONS_API_KEY` | [pollinations.ai](https://pollinations.ai) — free tier works without a key | Optional |

Everything else is optional and only needed for specific features (Stability AI, Runway video, etc.).

---

## 4. Set up DEV_PASSWORD (for developer tools)

BetaGrace vI includes two developer tool endpoints — Self-Mending Code Engine and Push-to-Code. These are password-protected and **disabled entirely in production**.

If you want to test them locally, generate a password and add it to your `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

Then add it to `.env`:

```
DEV_PASSWORD=the_value_you_just_generated
```

If `DEV_PASSWORD` is not set, those endpoints return `503` — all other features work normally without it. You will see `SKIPPED: DEV_PASSWORD not set` in the smoke test output for one test, which is expected.

> These endpoints are automatically disabled (`404`) when `NODE_ENV=production`. Never set `DEV_PASSWORD` in a production deployment.

---

## 5. Set up the database

```bash
make db
```

Or: `npx drizzle-kit push`

If you see a prompt asking to confirm destructive changes, type `yes` — it is safe on a fresh database.

---

## 6. Start the development server

```bash
make dev
```

Or: `npm run dev`

The server starts on **http://localhost:5000**. Open that in your browser and you will see the BetaGrace vI age-verification screen.

---

## 7. Verify everything is working

Run the full smoke test suite against your local server:

```bash
make test
```

Or: `BASE_URL=http://localhost:5000 npx tsx smoke-tests.ts`

You should see `52/52 PASSED` (or `51/52 PASSED` with one graceful skip if `DEV_PASSWORD` is not set). If any other test fails, the output will tell you exactly which endpoint and why.

To test against a deployed instance:

```bash
make test-remote URL=https://your-app.replit.app
```

---

## Project structure

```
betagrace/
├── client/              # React + Vite frontend
│   └── src/
│       ├── components/  # UI components (ChatInterface.tsx is the main one)
│       └── pages/       # Route-level pages
├── server/              # Express backend
│   ├── routes.ts        # All API endpoints (~5700 lines)
│   ├── ai.ts            # Multi-provider AI orchestration + fallback chain
│   ├── guardrails.ts    # 8-layer content safety system (1,175 lines)
│   ├── academic-research-engine.ts  # 70×7 Artifact Builder + Guard Loop
│   ├── video-engine-hydration.ts    # Storyboard + scene hydration engine
│   ├── synthesis-engine.ts          # Self-synthesizing memory system
│   └── index.ts         # Server bootstrap, CORS, security middleware
├── shared/
│   └── db-schema.ts     # Drizzle ORM schema (9 tables)
├── pipeline/            # Python video generation pipeline
├── smoke-tests.ts       # 52-test end-to-end test suite
├── .env.example         # Complete environment variable reference
└── .github/
    ├── workflows/ci.yml # GitHub Actions CI (runs on every push + PR)
    └── ISSUE_TEMPLATE/  # Bug report, feature request templates
```

---

## Key features to know about

**Academic Research Mode** — type `/full [topic]` in chat or use the "Write Artifact" toolbar button. Triggers the 70×7 pipeline: DuckDuckGo Guard Loop validates the topic, then 7 sections are written in the background. Progress polls every 3 seconds. Completed paper downloads as Markdown.

**Video Mode** — generates cinematic AI videos using the FFmpeg compile engine + Pollinations Flux image generation. Each scene is individually prompted and composited. Works without paid keys.

**Provider fallback chain** — all AI text generation runs in order:
1. Pollinations.ai (authenticated, if `POLLINATIONS_API_KEY` is set)
2. Pollinations.ai (anonymous free tier)
3. HuggingFace Llama 3.1-8B (if `HF_TOKEN` is set)
4. Local Synthesis Engine (always available, no keys needed)

The app works end-to-end with zero paid keys.

**Synthesis Mode** — the memory system learns from interactions per session. Stats visible at `GET /api/health/learning` using your `ADMIN_TOKEN`.

---

## Making a contribution

1. Fork the repo and create a branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes
3. Run TypeScript check: `make check`
4. Run smoke tests: `make test`
5. Open a pull request — fill in the PR template completely

PR guidelines:
- Keep each PR focused on one thing
- If you add a new endpoint, add a test for it in `smoke-tests.ts`
- If you change auth or security behaviour, update `SECURITY.md`
- No secrets, tokens, or passwords in any file — use environment variables

---

## Reporting a bug

Open a GitHub Issue using the Bug Report template. Include:
- What you were doing
- What you expected to happen
- What actually happened
- Server logs (from `npm run dev` terminal) and/or browser console errors
- Output of `BASE_URL=http://localhost:5000 npx tsx smoke-tests.ts` if relevant

---

## Security

If you find a security vulnerability, **do not open a public issue**. See [SECURITY.md](SECURITY.md) for the responsible disclosure process.
