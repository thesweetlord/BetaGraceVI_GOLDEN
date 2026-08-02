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

// Load environment variables before importing any server modules
import "dotenv/config";
import path from "path";

import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes.js";
import { synthesisEngine, injectKnowledgeSeed } from "./synthesis-engine.js";
import { serveStatic } from "./static.js";
import { createServer } from "http";
import { Pool } from "pg";
import os from "os";

// ─────────────────────────────────────────────────────────────────────────────
// Environment Variable Validation
// ─────────────────────────────────────────────────────────────────────────────
// OPENROUTER_API_KEY is used for cloud text generation; without it the app falls back to local synthesis.

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL Connection Pool Setup with Robust Error Handling
// ─────────────────────────────────────────────────────────────────────────────
const databaseUrl = process.env.DATABASE_URL?.trim();
let pool: Pool | null = null;

if (databaseUrl) {
  pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
  });

  pool.on("error", (err: Error) => {
    console.error("❌ Unexpected PostgreSQL pool error:", err.message);
  });
} else {
  console.warn(
    "⚠️  No DATABASE_URL provided. Starting in local dev fallback mode without PostgreSQL.",
  );
}

async function testDatabaseConnection() {
  if (!databaseUrl || !pool) {
    console.warn(
      "⚠️  Skipping database health check because DATABASE_URL is not configured.",
    );
    return true;
  }

  try {
    const client = await pool.connect();
    const result = await client.query(
      "SELECT NOW() as current_time, version() as pg_version",
    );
    console.log("✅ Connected to PostgreSQL!");
    console.log("   Database time:", result.rows[0].current_time);
    console.log(
      "   PostgreSQL version:",
      result.rows[0].pg_version.split(",")[0],
    );
    client.release();
    return true;
  } catch (err) {
    console.error(
      "❌ FATAL: Database connection error!",
      err instanceof Error ? err.message : String(err),
    );
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "⚠️  Continuing startup in development mode despite database connection failure.",
      );
      return true;
    }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Express App Setup
// ─────────────────────────────────────────────────────────────────────────────
const app = express();
app.disable("x-powered-by");
const httpServer = createServer(app);

// Trust Replit's reverse proxy so req.ip, req.secure, and x-forwarded-* work
app.set("trust proxy", 1);

// ─────────────────────────────────────────────────────────────────────────────
// CORS Configuration
// ─────────────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Session-ID', 'X-Admin-Token'],
}));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
    csrfToken?: string;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting Configuration
// ─────────────────────────────────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX_REQUESTS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Request Management Configuration
// ─────────────────────────────────────────────────────────────────────────────
const requestTimeout = 120000;
const maxConcurrentRequests = 1000;
let activeConcurrentRequests = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Body Parsing with Size Limits
// ─────────────────────────────────────────────────────────────────────────────
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
    limit: "50kb",
  }),
);

app.use(express.urlencoded({ extended: false, limit: "50kb" }));

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Security Headers (CSP, XSS Protection, etc.)
// ─────────────────────────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  // In development Vite uses new Function() / dynamic eval for source-map
  // injection and HMR, so 'unsafe-eval' must be present.  In production it
  // is compiled away and we drop it.
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? "'self' 'unsafe-inline'"
      : "'self' 'unsafe-inline' 'unsafe-eval'";

  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; ` +
      `script-src ${scriptSrc}; ` +
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
      `img-src 'self' https: data:; ` +
      `font-src 'self' https://fonts.gstatic.com; ` +
      `media-src 'self' blob: https:; ` +
      `connect-src 'self' wss: ws: https://image.pollinations.ai https://gen.pollinations.ai https://text.pollinations.ai https://openrouter.ai https://api.duckduckgo.com https://duckduckgo.com https://html.duckduckgo.com https:;`
  );
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=()",
  );

  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }

  if (!req.csrfToken) {
    req.csrfToken = Buffer.from(Math.random().toString())
      .toString("base64")
      .substring(0, 32);
  }

  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: HTTPS Enforcement (Production Only)
// ─────────────────────────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    process.env.NODE_ENV === "production" &&
    !req.secure &&
    req.get("x-forwarded-proto") !== "https"
  ) {
    return res.status(403).json({
      error: "HTTPS required",
      message: "This application requires a secure connection",
    });
  }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Cache Control
// API routes must never be cached. HTML/assets use browser defaults so that
// Replit's preview proxy can forward them correctly and mobile browsers don't
// receive a "no-store" directive that causes the preview to appear blank.
// ─────────────────────────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Concurrent Request Limiter
// ─────────────────────────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  if (activeConcurrentRequests >= maxConcurrentRequests) {
    return res.status(503).json({
      error: "Service unavailable",
      message:
        "Server is currently handling maximum concurrent requests. Please try again in a moment.",
    });
  }

  activeConcurrentRequests++;

  const cleanup = () => {
    activeConcurrentRequests--;
  };

  res.on("finish", cleanup);
  res.on("close", cleanup);

  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Request Timeout
// ─────────────────────────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  req.setTimeout(requestTimeout, () => {
    console.error(`[TIMEOUT] Request timed out: ${req.method} ${req.path}`);
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout" });
    }
  });

  res.setTimeout(requestTimeout, () => {
    console.error(`[TIMEOUT] Response timed out: ${req.method} ${req.path}`);
  });

  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Rate Limiting (Production Only)
// ─────────────────────────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV !== "production") {
    res.setHeader("X-RateLimit-Limit", "10000");
    res.setHeader("X-RateLimit-Remaining", "10000");
    return next();
  }

  const sessionId =
    (req.headers["user-agent"] || "unknown") +
    ":" +
    (req.headers["accept-language"] || "unknown");
  const now = Date.now();

  let rateLimitData = rateLimitMap.get(sessionId);

  if (!rateLimitData || now > rateLimitData.resetTime) {
    rateLimitData = { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
    rateLimitMap.set(sessionId, rateLimitData);
  }

  rateLimitData.count++;

  if (rateLimitData.count > RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      error: "Too many requests",
      message: "Rate limit exceeded. Please try again later.",
      retryAfter: Math.ceil((rateLimitData.resetTime - now) / 1000),
    });
  }

  res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS.toString());
  res.setHeader(
    "X-RateLimit-Remaining",
    (RATE_LIMIT_MAX_REQUESTS - rateLimitData.count).toString(),
  );
  res.setHeader(
    "X-RateLimit-Reset",
    new Date(rateLimitData.resetTime).toISOString(),
  );

  next();
});

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap.entries()) {
    if (now > value.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 300000);

// ─────────────────────────────────────────────────────────────────────────────
// Logging Utility
// ─────────────────────────────────────────────────────────────────────────────
export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Request Logging (Simplified to prevent errors)
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Database Health Check Endpoint
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/health/db", async (req: Request, res: Response) => {
  try {
    if (!pool) {
      return res.status(503).json({
        status: "unhealthy",
        database: "not configured",
        error: "Database not configured",
      });
    }
    const client = await pool.connect();
    const result = await client.query("SELECT NOW() as time");
    client.release();

    res.json({
      status: "healthy",
      database: "connected",
      timestamp: result.rows[0].time,
    });
  } catch (err) {
    console.error(
      "[HEALTH CHECK] Database connection failed:",
      err instanceof Error ? err.message : String(err),
    );
    res.status(503).json({
      status: "unhealthy",
      database: "disconnected",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Application Startup
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  console.log(
    "\n╔════════════════════════════════════════════════════════════╗",
  );
  console.log("║         🚀 BetaGrace vI Server Initialization 🚀          ║");
  console.log(
    "╚════════════════════════════════════════════════════════════╝\n",
  );

  const dbConnected = await testDatabaseConnection();

  if (!dbConnected) {
    console.error(
      "\n❌ FATAL: Cannot start server without database connection",
    );
    console.error("   Please check your DATABASE_URL environment variable");
    process.exit(1);
  }

  registerRoutes(app);
  console.log("✅ Routes registered successfully");

  // ── KNOWLEDGE SEED INJECTION — Wake Local Memory ──────────────────────────
  // Hydrates the BM25 synthesis engine with curated Q&A pairs on boot.
  // Safely wrapped; a seed injection failure cannot crash server startup.
  await injectKnowledgeSeed(synthesisEngine).catch((err) => {
    console.error("[BOOT] Knowledge Seed injection error (non-fatal):", err);
  });

  // ── 30-Day Data Retention Purge Job ─────────────────────────────────────────
  // Runs once at startup then every 24 hours. Deletes sessions (+ all cascade
  // child rows: messages, conversations, learning data, etc.) older than 30 days.
  const DATA_RETENTION_DAYS = 30;
  const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  const runRetentionPurge = async () => {
    try {
      const { storage } = await import("./storage.js");
      const purged = await storage.purgeExpiredSessions(DATA_RETENTION_DAYS);
      if (purged > 0) {
        console.log(`[RETENTION PURGE] ✅ Purged ${purged} session(s) older than ${DATA_RETENTION_DAYS} days`);
      } else {
        console.log(`[RETENTION PURGE] ✅ No expired sessions found (>${DATA_RETENTION_DAYS} days old)`);
      }
    } catch (err) {
      console.error("[RETENTION PURGE] ❌ Error during purge:", err instanceof Error ? err.message : err);
    }
  };

  // Run immediately on startup, then repeat every 24h
  runRetentionPurge();
  setInterval(runRetentionPurge, PURGE_INTERVAL_MS);

  // ── 12-Month Consent & Compliance Record Purge Job ───────────────────────────
  // Consent records are kept for a minimum of 12 months for legal audit purposes,
  // then automatically removed. Runs on startup and every 24 hours.
  const CONSENT_RETENTION_MONTHS = 12;
  const runConsentPurge = async () => {
    try {
      const { storage } = await import("./storage.js");
      const purged = await storage.purgeExpiredConsents(CONSENT_RETENTION_MONTHS);
      if (purged > 0) {
        console.log(`[CONSENT PURGE] ✅ Purged ${purged} consent record(s) older than ${CONSENT_RETENTION_MONTHS} months`);
      } else {
        console.log(`[CONSENT PURGE] ✅ No expired consent records found (>${CONSENT_RETENTION_MONTHS} months old)`);
      }
    } catch (err) {
      console.error("[CONSENT PURGE] ❌ Error during consent purge:", err instanceof Error ? err.message : err);
    }
  };
  runConsentPurge();
  setInterval(runConsentPurge, PURGE_INTERVAL_MS);

  app.use(
    (
      err: Error & { status?: number; statusCode?: number },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      console.error("[ERROR HANDLER]", {
        status,
        message,
        stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
      });

      if (!res.headersSent) {
        res.status(status).json({
          error: message,
          ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
        });
      }
    },
  );

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
    console.log("✅ Static file serving enabled (production mode)");
  } else {
    const { setupVite } = await import("./vite.js");
    await setupVite(httpServer, app);
    console.log("✅ Vite dev server enabled (development mode)");
  }

  const port = parseInt(process.env.PORT || "5000", 10);

  const getCurrentNetworkIp = () => {
    const interfaces = os.networkInterfaces();
    const candidates: string[] = [];

    // Collect all non-internal IPv4 addresses
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;

      // Skip virtual adapters and loopback
      if (name.toLowerCase().includes('virtual') ||
          name.toLowerCase().includes('vmware') ||
          name.toLowerCase().includes('virtualbox') ||
          name.toLowerCase().includes('docker') ||
          name.includes('Loopback')) {
        continue;
      }

      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal && addr.address !== "127.0.0.1") {
          candidates.push(addr.address);
        }
      }
    }

    // Prefer common interface patterns
    const preferred = candidates.find(ip =>
      ip.startsWith('192.168.') ||
      ip.startsWith('10.') ||
      ip.startsWith('172.')
    );

    const networkIp = preferred || candidates[0] || "0.0.0.0";
    // Only log in production for debugging network issues
    return networkIp;
  };

  const formatNetworkUrl = (ip: string) => `http://${ip}:${port}`;

  const printStartupBanner = () => {
    const networkIp = getCurrentNetworkIp();

    console.log(
      "\n╔════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║                  ✅ SERVER READY ✅                        ║",
    );
    console.log(
      "╠════════════════════════════════════════════════════════════╣",
    );
    console.log(
      `║  🌐 Localhost:    http://localhost:${port}${" ".repeat(
        Math.max(0, 18 - String(port).length),
      )} ║`,
    );
    console.log(
      `║  🌐 Network:      ${formatNetworkUrl(networkIp)}${" ".repeat(
        Math.max(0, 23 - networkIp.length - String(port).length),
      )} ║`,
    );
    console.log(
      `║  📦 Mode: ${(process.env.NODE_ENV || "development").padEnd(37)} ║`,
    );
    console.log(
      `║  🗄️  Database: ${pool ? "Connected" : "Unavailable (dev fallback)"}${" ".repeat(
        pool ? 14 : 5,
      )} ║`,
    );
    console.log(
      "╚════════════════════════════════════════════════════════════╝\n",
    );
  };

  let isListening = false;

  const onListening = () => {
    isListening = true;
    printStartupBanner();
  };

  const MAX_BIND_RETRIES = 10;
  const BIND_RETRY_DELAY_MS = 500;
  let bindAttempts = 0;

  const onListenError = (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && bindAttempts < MAX_BIND_RETRIES) {
      bindAttempts++;
      console.warn(
        `⚠️  Port ${port} busy (likely a previous instance releasing). ` +
          `Retry ${bindAttempts}/${MAX_BIND_RETRIES} in ${BIND_RETRY_DELAY_MS}ms…`,
      );
      setTimeout(() => httpServer.listen(port, "0.0.0.0"), BIND_RETRY_DELAY_MS);
      return;
    }
    console.error(`❌ FATAL: Failed to bind port ${port}:`, err.message);
    // Skip graceful shutdown — server never started, nothing to close cleanly
    if (pool) {
      pool.end().finally(() => process.exit(1));
    } else {
      process.exit(1);
    }
  };

  httpServer.on("listening", onListening);
  httpServer.on("error", onListenError);
  httpServer.listen(port, "0.0.0.0");

  // Debounced network change detection (Windows can have flaky interface changes)
  let lastNetworkIp = getCurrentNetworkIp();
  let lastChangeTime = Date.now();
  const NETWORK_CHANGE_COOLDOWN_MS = 15000; // Min 15s between checks to prevent spam
  
  setInterval(() => {
    const now = Date.now();
    if (now - lastChangeTime < NETWORK_CHANGE_COOLDOWN_MS) {
      return; // Too soon, skip
    }
    
    const currentNetworkIp = getCurrentNetworkIp();
    if (currentNetworkIp !== lastNetworkIp) {
      lastNetworkIp = currentNetworkIp;
      lastChangeTime = now;
      console.log("\n🔄 Network address changed!");
      printStartupBanner();
    }
  }, 5000);

  // ───────────────────────────────────────────────────────────────────────────
  // Graceful shutdown — idempotent, safe whether or not server is listening
  // ───────────────────────────────────────────────────────────────────────────
  let isShuttingDown = false;

  const gracefulShutdown = (signal: string) => {
    if (isShuttingDown) {
      console.log(`(already shutting down, ignoring ${signal})`);
      return;
    }
    isShuttingDown = true;
    console.log(`\n\n🛑 ${signal} received. Starting graceful shutdown...`);

    const closePool = async () => {
      try {
        if (pool) {
          await pool.end();
          console.log("✅ Database pool closed");
        }
      } catch (err) {
        console.error(
          "❌ Error closing database pool:",
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        process.exit(signal === "UNCAUGHT_EXCEPTION" ? 1 : 0);
      }
    };

    if (isListening) {
      httpServer.close(() => {
        console.log("✅ HTTP server closed");
        void closePool();
      });
    } else {
      void closePool();
    }

    setTimeout(() => {
      console.error("❌ Forced shutdown after timeout");
      process.exit(1);
    }, 10000).unref();
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  process.on("uncaughtException", (err: Error) => {
    console.error("❌ UNCAUGHT EXCEPTION:", err.message);
    console.error("Stack:", err.stack);
    gracefulShutdown("UNCAUGHT_EXCEPTION");
  });

  process.on("unhandledRejection", (reason: unknown) => {
    console.error(
      "❌ UNHANDLED REJECTION:",
      reason instanceof Error ? reason.message : String(reason),
    );
    if (reason instanceof Error && reason.stack) {
      console.error("Stack:", reason.stack);
    }
    // Don't force shutdown on unhandled rejection - just log it
    console.log("⚠️  Continuing operation after unhandled rejection");
  });
})();

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
export { pool };
export { httpServer };
export { app };
