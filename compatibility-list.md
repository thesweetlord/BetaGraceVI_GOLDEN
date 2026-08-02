# Compatibility List — BetaGrace vI
*Updated May 27, 2026 — v4.2*

---

## Minimum Browser Requirements

| Browser | Minimum Version |
|---|---|
| Chrome / Chromium | 90+ |
| Firefox | 88+ |
| Safari | 14+ |
| Edge | 90+ |
| Chrome for Android | 90+ |
| Safari (iOS) | 14+ |

**Requirements:** JavaScript enabled, cookies allowed (session persistence), no browser extensions blocking SSE/fetch.

---

## Text Chat & Streaming (SSE)

| Platform | Status |
|---|---|
| Desktop — all browsers | Fully supported |
| Android — Chrome | Fully supported |
| iOS — Safari | Fully supported |
| iOS — Chrome | Fully supported |

SSE streaming works on all modern browsers including mobile Safari. Token-by-token response delivery confirmed on iOS 14+ and Android Chrome 90+.

---

## Image Generation

| Platform | Status |
|---|---|
| Desktop — all browsers | Fully supported |
| Mobile — iOS + Android | Fully supported |

Pollinations Flux generates via URL — no binary upload or special browser capability required. Images load as standard `<img>` tags. 42 mix-and-match style descriptors with 150+ effective style combinations.

---

## Video Generation & Playback

| Platform | Status |
|---|---|
| Desktop — Chrome, Firefox, Edge | Fully supported |
| Desktop — Safari | Fully supported |
| Mobile — iOS Safari | Fully supported |
| Mobile — Android Chrome | Fully supported |

Delivered as MP4 (H.264 / AAC) with HTTP range-request headers. Compatible with all modern mobile browsers' native video players. Real-time storyboard preview works on all platforms during generation.

---

## 70×7 Academic Artifact Builder

| Platform | Status |
|---|---|
| Desktop — all browsers | Fully supported |
| Mobile — all modern browsers | Fully supported |

Background job pattern means no long-held connections. Live progress polling (every 3s) works on all platforms. Download button triggers standard browser file download. Artifacts are now persisted to PostgreSQL (`artifacts` table) and survive server restarts.

---

## Code Graph Panel

| Platform | Status | Notes |
|---|---|---|
| Desktop — all browsers | Fully supported | Full pan/zoom, best experience |
| Mobile — iOS + Android | Supported | Renders correctly; pinch-zoom recommended for large graphs |

SVG force-directed graph uses standard DOM SVG — no canvas, no WebGL. Works in all SVG-capable browsers.

---

## Advanced Image Generation (Hand Validation)

| Platform | Status |
|---|---|
| Desktop — all browsers | Fully supported |
| Mobile — iOS + Android | Fully supported |

---

## Data Export (GDPR Article 20)

| Export Type | Platform | Status |
|---|---|---|
| ZIP package (6 files + README) | Desktop — all browsers | Fully supported |
| ZIP package (6 files + README) | Mobile — iOS + Android | Fully supported |
| JSON export | Desktop — all browsers | Fully supported |
| JSON export | Mobile — iOS + Android | Fully supported |

ZIP export uses `application/zip` content-type with `Content-Disposition: attachment`. All modern browsers trigger a native download prompt.

---

## GDPR Article 17 Deletion Request

| Feature | Platform | Status |
|---|---|---|
| Deletion request form | Desktop — all browsers | Fully supported |
| Deletion request form | Mobile — iOS + Android | Fully supported |
| Admin deletion panel | Desktop — all browsers | Fully supported |
| Admin deletion panel | Mobile — iOS + Android | Fully supported |

---

## Node.js / Server Compatibility

| Environment | Status |
|---|---|
| Node.js 20 | Fully supported (recommended) |
| Node.js 18 | Supported |
| Node.js 22 | Supported |
| Replit | Fully supported (native deployment, autoscale target) |
| Railway | Supported |
| Render | Supported |
| Fly.io | Supported |
| VPS / bare metal | Supported |

---

## Database Compatibility

| Database | Status | Notes |
|---|---|---|
| PostgreSQL 16 | Fully supported (tested) |
| PostgreSQL 14+ | Fully supported |
| PostgreSQL 13 | Likely compatible, untested |
| Neon (serverless PG) | Fully supported |
| Supabase | Fully supported |
| Railway PostgreSQL | Fully supported |

SQLite, MySQL, and other databases are **not** supported — Drizzle ORM is configured for PostgreSQL only.

---

## Email Notifications (GDPR Art. 17 Admin Alerts)

| SMTP Provider | Status | Notes |
|---|---|---|
| Gmail (App Password) | Supported | Use App Password, not account password |
| SendGrid SMTP | Fully supported | Port 587, STARTTLS |
| Mailgun SMTP | Fully supported | Port 587 or 465 |
| AWS SES SMTP | Fully supported | Port 587 |
| Any RFC-5321 SMTP server | Supported | Configure via env vars |
| Not configured (no env vars) | Gracefully skipped | Requests still logged to DB; no crash |

Set `ADMIN_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in your environment to enable. All default to blank — no email is sent until you configure them.

---

## Python Pipeline (optional)

The `pipeline/` and `aletheia/` directories contain an optional Python video generation pipeline.

| Environment | Status |
|---|---|
| Python 3.11+ | Supported |
| Python 3.10 | Likely compatible, untested |
| Python 3.9 or below | Not supported |

The Python pipeline is independent of the main Node.js server and is not required for core functionality.
