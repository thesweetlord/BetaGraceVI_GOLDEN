# BetaGrace vI

Full-stack AI agent platform with 8 writing modes, video generation, academic paper builder, code graph analysis, and GDPR compliance. Built on TypeScript, React, Express, and PostgreSQL.

## How to run

The app starts with the **"Start application"** workflow (`npm run dev`), which runs the Express + Vite dev server on **port 5000**.

- Dev server: `npm run dev` (Express + Vite middleware, port 5000)
- DB schema push: `npm run db:push`
- Type check: `npm run check`
- Smoke tests: `npm test` (requires server running)

## Stack

- **Frontend**: React 18, Vite, Wouter (routing), TanStack Query, Tailwind CSS + Radix UI
- **Backend**: Express (TypeScript via tsx), Drizzle ORM
- **Database**: PostgreSQL (Replit managed) — schema in `shared/db-schema.ts`
- **AI providers**: Pollinations.ai (primary) → HuggingFace Llama 3.1-8B → Local synthesis engine (always available, no keys needed)

## Environment secrets

| Secret | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | ✅ Set | Express session signing |
| `POLLINATIONS_API_KEY` | ✅ Set | Primary AI provider (free tier works without it too) |
| `ADMIN_TOKEN` | Optional | Access `/api/health/learning` and admin endpoints |
| `HF_TOKEN` | Optional | HuggingFace fallback provider |
| `DEV_PASSWORD` | Optional | Dev-only endpoints (disabled in production) |

## Key routes

- `/` — Main chat dashboard (requires age verification on first visit)
- `/privacy-policy`, `/terms-of-service` — Public legal pages
- `/settings` — User settings
- `/admin/consent-audit` — Admin consent log (requires `X-Admin-Token` header)
- `/api/health` — Server + DB health check

## Notes

- First-time visitors see an age verification modal (18+ only). Completing it creates a session in PostgreSQL.
- The app runs entirely on free-tier AI providers — no paid keys required.
- Database schema is managed with Drizzle Kit (`drizzle.config.ts` → `shared/db-schema.ts`).

## User preferences

- Keep existing project structure and stack — do not restructure or migrate.
