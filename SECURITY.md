# Security Policy — BetaGrace vI

**Last Updated:** May 23, 2026
**Version:** BetaGrace vI

---

## Supported Versions

| Version | Supported | Security Updates |
|---|---|---|
| BetaGrace vI (current) | ✅ | Active |
| v4.0.x (internal) | ✅ | Critical only |
| v3.x (internal) | ❌ | Not supported |

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately using **GitHub Security Advisories**:

1. Go to the repository on GitHub
2. Click **Security → Advisories → New draft security advisory**
3. Fill in the details and submit — only you and the maintainer can see it until disclosure

Do not include sensitive exploit details in a public issue, comment, or pull request.

### What to include

- A clear description of the vulnerability
- Steps to reproduce (as minimal as possible)
- The affected version and configuration
- Your assessment of severity and impact
- Any suggested fix, if you have one

### Response timeline

| Stage | Target |
|---|---|
| Acknowledgment | Within 24 hours |
| Initial assessment | Within 72 hours |
| Fix for critical issues | Within 14 days |
| Fix for high/medium issues | Within 30 days |
| Coordinated disclosure | After fix is deployed |

Security researchers who report valid vulnerabilities in good faith will be acknowledged in the release notes.

---

## Security Architecture

BetaGrace implements an 8-layer security stack:

### Layer 1 — Perimeter Defense
- 1,000+ pattern adaptive threat detection
- Severity-based threat classification
- FTC Section 5 compliance enforcement

### Layer 2 — Age Verification (COPPA)
- Mandatory 18+ verification required before any content generation
- `isOver18 === true` enforced on every authenticated route — not just on login
- Persistent state tracked per session in PostgreSQL

### Layer 3 — Jailbreak Detection
- 156+ known jailbreak technique patterns matched and blocked
- Input normalisation and sanitisation before pattern matching
- Prompt injection detected and stripped

### Layer 4 — Content Filtering
- Rule-based allow/deny pattern matching
- Contextual content restrictions per AI mode
- Dynamic pattern learning from blocked attempts

### Layer 5 — Anomaly Detection
- Feature extraction: special characters, case distribution, digit ratio, whitespace
- Anomaly scoring with frequency tracking
- Signature-based detection of suspicious payloads

### Layer 6 — Session Validation
- Session ID format validation and integrity checks
- Age verification and mode state persistence
- 150-message session history limit

### Layer 7 — Content Length Enforcement
- 40,000 character maximum per message — enforced at route level
- Control characters automatically stripped
- Oversized messages return 400 before reaching AI provider

### Layer 8 — Privacy & Compliance
- GDPR-aligned: 30-day rolling retention, enforced on startup and every 24 hours
- Hard-delete: `DELETE /api/data-delete` cascades across all 9 database tables
- Data export: `GET /api/data-export` (GDPR Article 20)
- CCPA and COPPA compliance

---

## API Security

### Authentication
- Session-based: `X-Session-ID` header → cookie → `UA + IP + date` hash fingerprint
- No passwords stored — sessions are stateless identifiers
- Age gate enforced on every content generation endpoint

### Rate Limiting & Abuse Prevention
- **Rate limiter:** 100 requests per 60 seconds per session
- **Concurrency limiter:** max 1,000 simultaneous requests
- **Request timeout:** 120-second hard cap on all requests
- **Body limit:** 50kb — enforced by body-parser before any route logic runs

### Admin Endpoint
`GET /api/health/learning` requires `X-Admin-Token` header matching `process.env.ADMIN_TOKEN`.
- Returns `401` if token is missing or incorrect
- Server logs a warning and hard-refuses if `ADMIN_TOKEN` is not set at startup
- **Never set a default value** — always generate a unique token per deployment

### Environment Variables
All secrets are managed via environment variables. No API keys, tokens, or credentials are hardcoded anywhere in the source. See `.env.example` for the full reference.

---

## Data Security

| Concern | How it is addressed |
|---|---|
| Transport | TLS enforced in production (HTTPS redirect) |
| Database credentials | Environment variable only — never in source |
| Session secrets | Environment variable only |
| API keys | Environment variable only |
| Generated videos/images | Stored in `attached_assets/` — excluded from version control |
| Conversation data | Never logged to files — PostgreSQL only |
| Learning data | Per-session isolation — one session never influences another |

---

## Security Best Practices for Operators

When deploying BetaGrace:

1. Generate strong, unique values for `ADMIN_TOKEN` and `SESSION_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Never reuse tokens across deployments
3. Set up TLS (HTTPS) before accepting real users
4. Keep `ADMIN_TOKEN` out of client-side code and browser requests
5. Configure database backups — hard-deletes are irreversible
6. Review rate limits for your expected traffic volume

---

**BetaGrace is committed to maintaining a secure, trustworthy platform for its users and the open-source community.**
