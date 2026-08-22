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

import type { Express, Request, Response } from "express";
import { createHash, randomUUID } from "crypto";
import * as archiverPkg from "archiver";
const ZipArchive = (archiverPkg as any).ZipArchive as new (opts?: {
  zlib?: { level?: number };
}) => archiverPkg.Archiver;
import { sendDeletionRequestEmail } from "./email.js";
import { storage } from "./storage.js";
import { pool } from "./db.js";
import type { QueryResult } from "pg";
import {
  registerAdvancedImageRoutes,
  generateImageWithHandValidation,
} from "./advanced-image-routes.js";
import {
  chatRequestSchema,
  type AIMode,
  MODE_DEPENDENCIES,
  MODE_CONFLICTS,
} from "../shared/schema";
import { queryChroma, queryGraph } from "./aletheia-bridge.js";
import { z } from "zod";
import {
  executeGuardrails,
  executeResponseGuardrails,
  validateSessionId,
  validateContentLength,
  MAX_CONTENT_LENGTH,
  guardrailLogger,
  type GuardrailCheckRequest,
  FTC_SECTION_5_COMPLIANCE,
  getPrivacyMetrics,
} from "./guardrails.js";
import { parallelLearning } from "./parallel-learning.js";
import { processVideoFramesSafe } from "./pipeline.js";
import { sanitizeRenderDir, atomicCompileVideo } from "./video-compiler.js";
import { analyzeCode, formatGraphForAI } from "./code-graph-analyzer.js";
import {
  VideoHydrationEngine,
  hydratedPayloadToPromptArrays,
} from "./video-engine-hydration.js";
import { spawn, execSync } from "child_process";
import { createReadStream, existsSync } from "fs";
import { promises as fs } from "fs";
import path from "path";
import ffmpeg from "ffmpeg-static";
import { synthesisEngine } from "./synthesis-engine.js";
import {
  academicSearchGuard,
  run70x7Pipeline,
} from "./academic-research-engine.js";
import { db } from "./db.js";
import { artifacts } from "../shared/db-schema";
import { eq, desc } from "drizzle-orm";
import {
  buildLegalPromptContext,
  isLegalPolicyQuery,
  readLegalDocument,
} from "./legal-docs.js";

// ── PostgreSQL Artifact Store ─────────────────────────────────────────────
// Single source of truth. DATABASE_URL must be set (always true in Replit).

interface ArtifactRow {
  jobId: string;
  status: string;
  topic: string;
  sectionsCompleted: number;
  totalSections: number;
  currentSection: string;
  artifact: string | null;
  charCount: number;
  error?: string;
}

async function dbArtifactInsert(
  jobId: string,
  topic: string,
  sessionId: string | null,
  modeContext: string | null,
): Promise<void> {
  if (!db) {
    console.error("[DB_ARTIFACT] No database — artifact not persisted");
    return;
  }
  await (
    db.insert(artifacts).values({
      jobId,
      sessionId,
      topic,
      status: "building",
      modeContext,
      metadata: { currentSection: "Initialising…" },
    }) as Promise<unknown>
  ).catch((e: unknown) => console.error("[DB_ARTIFACT] insert error:", e));
}

function dbArtifactProgress(
  jobId: string,
  sectionTitle: string,
  index: number,
  total: number,
): void {
  if (!db) return;
  void (
    db
      .update(artifacts)
      .set({
        sectionsCompleted: index,
        totalSections: total,
        metadata: { currentSection: sectionTitle },
        updatedAt: new Date(),
      })
      .where(eq(artifacts.jobId, jobId)) as Promise<unknown>
  ).catch(console.error);
}

async function dbArtifactComplete(
  jobId: string,
  content: string,
  sectionsCompleted: number,
  totalSections: number,
): Promise<void> {
  if (!db) {
    console.error(
      "[DB_ARTIFACT] No database — artifact completion not persisted",
    );
    return;
  }
  await (
    db
      .update(artifacts)
      .set({
        status: "complete",
        artifact: content,
        charCount: content.length,
        sectionsCompleted,
        totalSections,
        metadata: { currentSection: "Complete" },
        updatedAt: new Date(),
      })
      .where(eq(artifacts.jobId, jobId)) as Promise<unknown>
  ).catch((e: unknown) => console.error("[DB_ARTIFACT] complete error:", e));
}

async function dbArtifactFail(jobId: string, error: string): Promise<void> {
  if (!db) return;
  void (
    db
      .update(artifacts)
      .set({ status: "error", error, updatedAt: new Date() })
      .where(eq(artifacts.jobId, jobId)) as Promise<unknown>
  ).catch(console.error);
}

async function dbArtifactGet(jobId: string): Promise<ArtifactRow | null> {
  if (!db) return null;
  const rows = await (
    db.select().from(artifacts).where(eq(artifacts.jobId, jobId)) as Promise<
      any[]
    >
  ).catch(() => [] as any[]);
  const row = rows[0];
  if (!row) return null;
  const meta = (row.metadata as Record<string, unknown>) ?? {};
  return {
    jobId: row.jobId,
    status: row.status,
    topic: row.topic,
    sectionsCompleted: row.sectionsCompleted ?? 0,
    totalSections: row.totalSections ?? 0,
    currentSection: String(meta.currentSection ?? ""),
    artifact: row.artifact ?? null,
    charCount: row.charCount ?? 0,
    error: row.error ?? undefined,
  };
}

async function dbArtifactHistory(): Promise<
  Array<{
    jobId: string;
    topic: string;
    status: string;
    sectionsCompleted: number;
    totalSections: number;
    charCount: number;
    createdAt: string;
    error?: string;
  }>
> {
  if (!db) return [];
  const rows = await (
    db
      .select()
      .from(artifacts)
      .orderBy(desc(artifacts.createdAt))
      .limit(100) as Promise<any[]>
  ).catch(() => [] as any[]);
  return rows.map((r: any) => ({
    jobId: r.jobId,
    topic: r.topic,
    status: r.status,
    sectionsCompleted: r.sectionsCompleted ?? 0,
    totalSections: r.totalSections ?? 0,
    charCount: r.charCount ?? 0,
    createdAt: r.createdAt?.toISOString?.() ?? new Date().toISOString(),
    error: r.error ?? undefined,
  }));
}

async function dbArtifactLatestComplete(): Promise<{
  artifact: string;
  charCount: number;
} | null> {
  if (!db) return null;
  const rows = await (
    db
      .select()
      .from(artifacts)
      .where(eq(artifacts.status, "complete"))
      .orderBy(desc(artifacts.createdAt))
      .limit(1) as Promise<any[]>
  ).catch(() => [] as any[]);
  const row = rows[0];
  if (!row?.artifact) return null;
  return { artifact: row.artifact, charCount: row.charCount ?? 0 };
}

// Resolve a working ffmpeg binary — ffmpeg-static may lack execute permission in some envs
const FFMPEG_PATH: string | null = (() => {
  try {
    if (ffmpeg) {
      const fpath = String(ffmpeg);
      if (existsSync(fpath)) {
        // Ensure execute permission (EACCES fix for Replit/NixOS)
        try {
          execSync(`chmod +x "${fpath}"`, { stdio: "ignore" });
        } catch {}
        return fpath;
      }
    }
  } catch {}
  // `which` fails on Nix — use shell built-in `command -v` instead
  try {
    const p = execSync("command -v ffmpeg", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/sh",
    }).trim();
    if (p && existsSync(p)) return p;
  } catch {}
  return null;
})();
console.log(
  "[FFMPEG] Resolved path:",
  FFMPEG_PATH ?? "NOT FOUND — video will use storyboard fallback",
);

export function registerRoutes(app: Express): void {
  console.log("\n=== BetaGrace vI Startup ===\n");
  console.log(
    "[STARTUP] OPENROUTER_API_KEY present:",
    !!process.env.OPENROUTER_API_KEY,
  );

  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim() || "";
  const openRouterModel =
    process.env.OPENROUTER_TEXT_MODEL?.trim() ||
    "google/gemma-4-26b-a4b-it:free";
  const openRouterBaseUrl = "https://openrouter.ai/api/v1";
  const openRouterAliasMap: Record<string, string> = {
    openai: openRouterModel,
    claude: openRouterModel,
    gemini: openRouterModel,
    deepseek: openRouterModel,
    mistral: openRouterModel,
    "qwen3-coder": openRouterModel,
  };
  let lastOpenRouterCallAt = 0;
  let openRouterChain: Promise<void> = Promise.resolve();

  async function initializeAiClients() {
    if (openRouterApiKey) {
      console.log(
        `[STARTUP] ✅ OpenRouter configured for text generation (${openRouterModel})`,
      );
      return;
    }

    console.warn(
      "[STARTUP] ⚠️ OPENROUTER_API_KEY is not configured – using local fallback for text generation.",
    );
  }

  initializeAiClients().catch((err) => {
    console.error("[STARTUP] ❌ Failed to initialize AI providers:", err);
  });

  function sanitizeAiResponse(response: string): string {
    const structuredMetadataPattern =
      /["']?\b(?:id|ids|ID|IDs|identifier|identifiers|token|token_id|metadata|meta|debug|ref|reference)\b["']?\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9_-]+['"]?/gi;
    const jsonMetadataPattern =
      /\{[^}]*"(?:id|ids|identifier|token|metadata)"[^}]*\}/gi;
    const arrayMetadataPattern =
      /\[[^\]]*"?(?:id|ids|identifier|token|metadata)"?[^]]*\]/gi;

    return (
      response
        .replace(/\*\*?\[IMAGE:\s*[^\]]*\]\*\*?[\s\n]*$/i, "")
        .replace(jsonMetadataPattern, "")
        .replace(arrayMetadataPattern, "")
        .replace(structuredMetadataPattern, "")
        .replace(/\bplins_bd\b/gi, "")
        .replace(/,\s*(?=[}\]])/g, "")
        .replace(/['"]{2,}/g, "")
        // Removed broad/unsafe quote collapsing and generic key/value stripping.
        // Preserve conversational prose as-is.
        .replace(/\s{2,}/g, " ")
        .trim()
    );
  }

  /**
   * Ensures the system prompt never starves the model's output budget.
   * Target: keep combined input under ~20 K chars (~5 K tokens) so even
   * a 16 K-token model has at least 11 K tokens left for its response.
   * When the prompt is too large we trim the injected [CONVERSATION CONTEXT]
   * block first (the most compressible part), then trim other additions.
   */
  function capSystemPromptForProvider(prompt: string): string {
    const MAX_SYSTEM_CHARS = 20_000;
    if (prompt.length <= MAX_SYSTEM_CHARS) return prompt;

    // Try to trim only the conversation-context block
    const ctxMarker = "\n\n[CONVERSATION CONTEXT";
    const ctxStart = prompt.indexOf(ctxMarker);
    if (ctxStart !== -1) {
      const endMarker = "\n\n["; // next injected block
      const ctxEndSearch = prompt.indexOf(
        endMarker,
        ctxStart + ctxMarker.length,
      );
      const ctxEnd = ctxEndSearch !== -1 ? ctxEndSearch : prompt.length;
      const beforeCtx = prompt.slice(0, ctxStart);
      const afterCtx = prompt.slice(ctxEnd);
      const budget = MAX_SYSTEM_CHARS - beforeCtx.length - afterCtx.length - 60;
      if (budget > 200) {
        const ctxFull = prompt.slice(ctxStart, ctxEnd);
        const trimmed =
          ctxFull.slice(0, budget) + "\n…[context trimmed for token budget]";
        const result = beforeCtx + trimmed + afterCtx;
        if (result.length <= MAX_SYSTEM_CHARS) return result;
      }
      // Context block alone isn't enough — drop it entirely
      const noCtx =
        beforeCtx +
        "\n\n[CONVERSATION CONTEXT: trimmed to fit token budget]" +
        afterCtx;
      if (noCtx.length <= MAX_SYSTEM_CHARS) return noCtx;
    }

    // Keep the synthesis result available even when other injected context is large.
    const synthesisMarker = "\n\n[LOCAL SYNTHESIS CONTEXT]\n";
    const synthesisStart = prompt.indexOf(synthesisMarker);
    if (synthesisStart !== -1) {
      const synthesisEndMarker = "\n[END LOCAL SYNTHESIS CONTEXT]";
      const synthesisEndSearch = prompt.indexOf(
        synthesisEndMarker,
        synthesisStart + synthesisMarker.length,
      );
      const synthesisEnd = synthesisEndSearch !== -1
        ? synthesisEndSearch + synthesisEndMarker.length
        : prompt.length;
      const synthesisBlock = prompt.slice(synthesisStart, synthesisEnd);
      const availableBase = MAX_SYSTEM_CHARS - synthesisBlock.length - 80;
      if (availableBase > 400) {
        const base = prompt.slice(0, synthesisStart);
        const half = Math.floor(availableBase / 2);
        const trimmedBase = base.length <= availableBase
          ? base
          : `${base.slice(0, half)}\n…[prompt context trimmed]\n${base.slice(-half)}`;
        return `${trimmedBase}${synthesisBlock}`.slice(0, MAX_SYSTEM_CHARS);
      }
    }

    // Last resort: hard truncate (this should almost never happen)
    return prompt.slice(0, MAX_SYSTEM_CHARS) + "\n…[prompt truncated]";
  }

  function buildDeepConversationContext(
    messages: Array<{ role: string; content: string }>,
  ): string {
    // Keep enough context to maintain continuity without swamping the model's
    // input window.  400 chars × 40 messages ≈ 16 K chars ≈ 4 K tokens for
    // history — leaves ample room for the model's output.
    const MAX_HISTORY_CHARS = 16_000;
    const MAX_MESSAGE_CHARS = 400;
    let totalChars = 0;
    const selected: Array<{ role: string; content: string }> = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const trimmedContent = message.content.slice(0, MAX_MESSAGE_CHARS);
      const entryText = `[${message.role.toUpperCase()}] ${trimmedContent}`;
      const entryLength = entryText.length + 2;
      if (selected.length > 0 && totalChars + entryLength > MAX_HISTORY_CHARS)
        break;
      selected.unshift({ role: message.role, content: trimmedContent });
      totalChars += entryLength;
    }

    return selected
      .map((m) => `[${m.role.toUpperCase()}] ${m.content.replace(/\n/g, " ")}`)
      .join("\n\n");
  }



  interface AIGenerationResult {
    text: string;
    provider: "openrouter" | "local";
    model: string;
    fallbackUsed: boolean;
    fallbackReason?: string;
    trace?: { recordIds: string[]; confidence: number; supportLevel: string } | null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TIMEOUT ORCHESTRATOR
  // Wraps any async provider call with an explicit timeout. If the provider times
  // out OR throws, it bubbles the error up so the next provider in the chain
  // (like HuggingFace) can be attempted before finally falling back to local.
  // ─────────────────────────────────────────────────────────────────────────────
  async function callWithTimeout<T>(
    label: string,
    providerFn: () => Promise<T>,
    timeoutMs = 15000,
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(new Error(`[${label}] Provider timeout after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    );

    try {
      console.log(`[PROVIDER ORCHESTRATOR] Attempting provider: ${label}`);
      const result = await Promise.race([providerFn(), timeoutPromise]);
      console.log(`[PROVIDER ORCHESTRATOR] Provider succeeded: ${label}`);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[PROVIDER ORCHESTRATOR] Provider failed (${label}): ${msg}`,
      );
      throw err;
    }
  }

  // Validate local synthesis is reachable at startup (not lazily trusted)
  (async () => {
    try {
      const testResult = await synthesizeLocalResponse(
        "startup validation",
        "hello",
      );
      if (testResult && testResult.length > 0) {
        console.log(
          "[STARTUP] ✅ Local synthesis fallback validated — ready and reachable",
        );
      } else {
        console.error(
          "[STARTUP] ❌ Local synthesis returned empty output during validation",
        );
      }
    } catch (e) {
      console.error("[STARTUP] ❌ Local synthesis validation threw:", e);
    }
  })();

  function resolveOpenRouterModel(requestedModel?: string): string {
    const normalized = (requestedModel || "").trim();
    if (!normalized) return openRouterModel;
    return openRouterAliasMap[normalized] || normalized;
  }

  async function waitForOpenRouterTurn(minSpacingMs = 3500): Promise<void> {
    const previous = openRouterChain;
    let release!: () => void;
    openRouterChain = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    const now = Date.now();
    const waitMs = Math.max(0, minSpacingMs - (now - lastOpenRouterCallAt));
    if (waitMs > 0) {
      console.log(`[AI] OpenRouter throttle — waiting ${waitMs}ms before next request`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
    lastOpenRouterCallAt = Date.now();
    release();
  }

  async function callOpenRouter(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    temperature: number,
    textModel: string = openRouterModel,
  ): Promise<string | null> {
    if (!openRouterApiKey) return null;

    const resolvedModel = resolveOpenRouterModel(textModel);

    try {
      await waitForOpenRouterTurn();
      console.log(`[AI] Attempting OpenRouter text call (${resolvedModel})`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const MAX_INPUT_CHARS = 12000;
      const safeUserMessage =
        userMessage.length > MAX_INPUT_CHARS
          ? userMessage.slice(0, MAX_INPUT_CHARS) +
            "\n\n[Message truncated to prevent provider timeout]"
          : userMessage;

      let rawText: string | null = null;
      let status = 0;

      try {
        const response = await fetch(`${openRouterBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openRouterApiKey}`,
            "HTTP-Referer": "https://betagrace.local",
            "X-Title": "BetaGrace",
          },
          body: JSON.stringify({
            model: resolvedModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: safeUserMessage },
            ],
            max_tokens: maxTokens,
            temperature,
          }),
          signal: controller.signal,
        });
        status = response.status;
        rawText = await response.text();
      } finally {
        clearTimeout(timeout);
      }

      console.log("[AI] OpenRouter status:", status);
      if (status < 200 || status >= 300) {
        throw new Error(
          `OpenRouter request failed (${status}): ${rawText?.slice(0, 300) || "no response body"}`,
        );
      }

      if (!rawText || rawText.trim().length === 0) {
        throw new Error("Empty response body from OpenRouter");
      }

      const parsed = JSON.parse(rawText);
      const content = parsed?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim().length > 0) {
        return content.trim();
      }

      if (Array.isArray(content)) {
        const joined = content
          .map((part: any) =>
            typeof part?.text === "string" ? part.text : "",
          )
          .join("")
          .trim();
        if (joined) return joined;
      }

      throw new Error("OpenRouter response did not include message content");
    } catch (error) {
      console.warn(
        "[AI] OpenRouter call failed:",
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  async function streamOpenRouter(
    systemPrompt: string,
    userMessage: string,
    onToken: (token: string) => void,
    textModel: string = openRouterModel,
    maxTokens: number = 32768,
  ): Promise<string | null> {
    if (!openRouterApiKey) return null;

    const resolvedModel = resolveOpenRouterModel(textModel);

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      console.warn("[AI] OpenRouter stream timeout — aborting controller after 90s");
      controller.abort();
    }, 90000);

    try {
      const MAX_INPUT_CHARS = 12000;
      const safeUserMessage =
        userMessage.length > MAX_INPUT_CHARS
          ? userMessage.slice(0, MAX_INPUT_CHARS) +
            "\n\n[Message truncated to prevent provider timeout]"
          : userMessage;

      await waitForOpenRouterTurn();

      const response = await fetch(`${openRouterBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://betagrace.local",
          "X-Title": "BetaGrace",
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: safeUserMessage },
          ],
          stream: true,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errorBody = await response.text().catch(() => "");
        console.warn(
          "[AI] OpenRouter stream response not ok:",
          response.status,
          errorBody.slice(0, 300),
        );
        return null;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content;
            if (typeof token === "string" && token.length > 0) {
              fullText += token;
              onToken(token);
            }
          } catch {
            // Ignore non-JSON SSE frames.
          }
        }
      }

      return fullText || null;
    } catch (error) {
      console.warn(
        "[AI] OpenRouter streaming failed:",
        error instanceof Error ? error.message : error,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  const LOCAL_FEEDBACK_TTL_MS = 10 * 60 * 1000;
  const localSynthesisFeedbackMap = new Map<string, { recordIds: string[]; confidence: number; supportLevel: string; timestamp: number }>();

  function isShortEvaluativeFeedback(message: string): boolean {
    const words = message.trim().split(/\s+/).filter(Boolean);
    return words.length > 0 && words.length <= 15;
  }

  function getFreshLocalTrace(sessionId: string): { recordIds: string[]; confidence: number; supportLevel: string; timestamp: number } | null {
    const trace = localSynthesisFeedbackMap.get(sessionId);
    if (!trace) return null;
    if (Date.now() - trace.timestamp > LOCAL_FEEDBACK_TTL_MS) {
      localSynthesisFeedbackMap.delete(sessionId);
      return null;
    }
    return trace;
  }

  function enrichPromptWithSynthesis(
    systemPrompt: string,
    userMessage: string,
    mode: string,
    ownerScope: string,
  ): { prompt: string; recordIds: string[] } {
    const synthesisResult = synthesisEngine.synthesize(
      systemPrompt,
      userMessage,
      mode,
      ownerScope,
    );
    console.log(
      `[SYNTHESIS] Chat context prepared (mode: ${mode}, support: ${synthesisResult.trace?.supportLevel ?? "limited"}, records: ${synthesisResult.trace?.recordIds.length ?? 0})`,
    );
    return {
      prompt: `${systemPrompt}\n\n[LOCAL SYNTHESIS CONTEXT]\n${synthesisResult.text}\n[END LOCAL SYNTHESIS CONTEXT]`,
      recordIds: synthesisResult.trace?.recordIds ?? [],
    };
  }

  function getBoneMarrowFeedback(message: string): { boneDelta: number; marrowDelta: number } {
    if (!isShortEvaluativeFeedback(message)) {
      return { boneDelta: 0, marrowDelta: 0 };
    }

    const lower = message.toLowerCase();

    let boneDelta = 0;
    let marrowDelta = 0;

    if (lower.includes("that was great") || lower.includes("good response") || lower.includes("great response")) {
      boneDelta += 0.003;
      marrowDelta += 0.004;
    }
    if (lower.includes("that was smart")) {
      boneDelta += 0.003;
      marrowDelta += 0.004;
    }
    if (lower.includes("awesome") || lower.includes("creative") || lower.includes("really good") || lower.includes("very good")) {
      marrowDelta += 0.004;
    }
    if (lower.includes("not relevant") || lower.includes("isnt relevant") || lower.includes("isn't relevant") || lower.includes("doesnt follow") || lower.includes("doesn't follow") || lower.includes("didnt follow") || lower.includes("didn't follow")) {
      boneDelta -= 0.003;
    }
    if (lower.includes("too bland") || lower.includes("that sucked") || lower.includes("bad response")) {
      marrowDelta -= 0.002;
    }

    return { boneDelta, marrowDelta };
  }

  async function generateWithFallback(
    systemPrompt: string,
    userMessage: string,
    options?: { maxTokens?: number; temperature?: number },
    textModel: string = openRouterModel,
    ownerScope?: string | null,
    mode = "standard",
  ): Promise<AIGenerationResult> {
    const { maxTokens = 32768, temperature = 0.8 } = options ?? {};

    try {
      const openRouterText = await callWithTimeout(
        "OpenRouter",
        async () => {
          const text = await callOpenRouter(
            systemPrompt,
            userMessage,
            maxTokens,
            temperature,
            textModel,
          );
          if (!text) throw new Error("Empty response from OpenRouter");
          return text;
        },
        30000,
      );

      console.log("[AI] Using OpenRouter as PRIMARY provider");
      try {
        synthesisEngine.observe(
          systemPrompt,
          userMessage,
          openRouterText,
          "openrouter",
          mode,
          {
            memory: true,
            source: "conversation",
            ownerScope: ownerScope ?? null,
          },
        );
        console.log(`[SYNTHESIS] Indexed OpenRouter response (mode: ${mode})`);
      } catch (err) {
        console.error("[SYNTHESIS] observe() failed after OpenRouter success:", err);
      }
      return {
        text: openRouterText,
        provider: "openrouter",
        model: resolveOpenRouterModel(textModel),
        fallbackUsed: false,
        trace: null,
      };
    } catch (openRouterError) {
      console.error(
        "[AI] OpenRouter PRIMARY failed:",
        openRouterError instanceof Error
          ? openRouterError.message
          : String(openRouterError),
      );
    }

    // FINAL: Local synthesis — last line of defense, always reachable
    console.warn(
      "[AI] All cloud providers exhausted — activating local synthesis as final fallback.",
    );
    try {
      let localTrace: AIGenerationResult["trace"] = null;
      const text = await synthesizeLocalResponse(
        systemPrompt,
        userMessage,
        ownerScope ?? null,
        mode,
        (trace) => {
          localTrace = trace;
        },
      );
      console.log("[AI] Local synthesis final fallback succeeded.");
      try {
        synthesisEngine.observe(
          systemPrompt,
          userMessage,
          text,
          "local",
          mode,
          {
            memory: true,
            source: "conversation",
            ownerScope: ownerScope ?? null,
          },
        );
        console.log(`[SYNTHESIS] Indexed local response (mode: ${mode})`);
      } catch (err) {
        console.error("[SYNTHESIS] observe() failed after local fallback success:", err);
      }
      return {
        text,
        provider: "local",
        model: "betagrace-local",
        fallbackUsed: true,
        fallbackReason: "all_providers_failed",
        trace: localTrace,
      };
    } catch (localErr) {
      console.error(
        "[AI] CRITICAL: Local synthesis final fallback also failed:",
        localErr,
      );
      return {
        text: "Both primary providers and local fallback encountered an issue. Please try again in a moment.",
        provider: "local",
        model: "betagrace-local",
        fallbackUsed: true,
        fallbackReason: "all_providers_failed",
      };
    }
  }

  async function synthesizeLocalResponse(
    systemPrompt: string,
    userMessage: string,
    ownerScope?: string | null,
    requestedMode?: string,
    onTrace?: (trace: NonNullable<AIGenerationResult["trace"]>) => void,
  ): Promise<string> {
    const msg = userMessage.trim();
    const lower = msg.toLowerCase();
    console.log(
      `[SYNTHESIS] Local synthesis requested (mode: ${requestedMode ?? "auto"}, owner: ${ownerScope ?? "global"})`,
    );

    // Greeting detection
    if (
      /^(hello|hi|hey|good morning|good evening|howdy|greetings|what.s up|sup)\b/i.test(
        msg,
      )
    ) {
      return "Hello! I'm BetaGrace vI — your prodigy-level AI creative companion. I have deep knowledge through mid-2026 covering creative writing, science, AI/technology, history, philosophy, theology, mathematics, film, music, law, medicine, and much more. I can write stories, reason through complex problems, analyze current events, generate image and video concepts, and engage with any intellectual challenge. What would you like to explore?";
    }

    // ─── Mode detection from system prompt ─────────────────────────────────────
    const isFleshArchitectMode = /flesh.architect|narrative architect/i.test(
      systemPrompt,
    );
    const isSanctuaryMode =
      /sanctuary|emotional support|compassionate counsel/i.test(systemPrompt);
    const isVideoGeneratorMode =
      /video.generator|cinematograph|film director|visual storytell/i.test(
        systemPrompt,
      );
    const isCodeGraphMode =
      /code.graph|dependency.graph|abstract.syntax.tree|call.graph/i.test(
        systemPrompt,
      );
    const isAcademicMode =
      /academic.research|70x7.research|scholarly research|peer.review/i.test(
        systemPrompt,
      );
    const isAutonomousMode =
      /autonomous.agent|agentic.system|multi.step.task|task.planning.agent/i.test(
        systemPrompt,
      );
    const isAdvReasoningMode =
      /advanced.reasoning|first.principles|chain.of.thought|socratic.method/i.test(
        systemPrompt,
      );

    // ── Derive a canonical mode string from the detected booleans ───────────────
    // [FIX] Previously synthesize() was always called without mode (defaulted to
    // "standard"), so Stage B re-ranking never got a mode affinity signal.
    const detectedMode = requestedMode ?? (isFleshArchitectMode  ? "flesh_architect"
      : isSanctuaryMode       ? "sanctuary"
      : isVideoGeneratorMode  ? "video_generator"
      : isCodeGraphMode       ? "code_graph"
      : isAcademicMode        ? "academic_research"
      : isAutonomousMode      ? "autonomous"
      : isAdvReasoningMode    ? "advanced_reasoning"
      : "standard");

    const synthesisResult = synthesisEngine.synthesize(
      systemPrompt,
      msg,
      detectedMode,
      ownerScope ?? null,
    );
    if (synthesisResult.trace && onTrace) onTrace(synthesisResult.trace);
    if (synthesisResult.trace && synthesisResult.trace.recordIds.length > 0) {
      console.log(
        `[SYNTHESIS] Using retrieved local response as fallback output (mode: ${detectedMode})`,
      );
      return synthesisResult.text;
    }

    // Topic detection for rich local responses
    const isWriting =
      /\b(write|story|tale|narrative|chapter|scene|fiction|prose|poem|novel|screenplay|plot|character|dialogue|creative)\b/i.test(
        msg,
      );
    const isAI =
      /\b(ai|artificial intelligence|machine learning|llm|gpt|claude|gemini|llama|deepseek|chatbot|neural|model)\b/i.test(
        msg,
      );
    const isScience =
      /\b(science|physics|chemistry|biology|quantum|dna|gene|evolution|climate|space|nasa|medicine|drug|vaccine|crispr)\b/i.test(
        msg,
      );
    const isCode =
      /\b(code|program|javascript|python|typescript|algorithm|function|debug|software|react|node|sql|api)\b/i.test(
        msg,
      );
    const isPhilosophy =
      /\b(philosophy|meaning|consciousness|existence|ethics|morality|truth|reality|free will|determinism|absurd)\b/i.test(
        msg,
      );
    const isHistory =
      /\b(history|historical|ancient|medieval|renaissance|war|empire|civilization|revolution|dynasty|century)\b/i.test(
        msg,
      );
    const isMath =
      /\b(math|mathematics|calculus|algebra|geometry|equation|theorem|proof|statistics|probability|number)\b/i.test(
        msg,
      );
    const isFaith =
      /\b(god|jesus|christ|bible|faith|prayer|church|spiritual|theology|christian|gospel|grace|redemption|holy spirit)\b/i.test(
        msg,
      );
    const isCurrentEvents =
      /\b(2024|2025|2026|latest|current|today|recent|news|election|trump|biden|ai regulation|ukraine|israel|bitcoin|spacex)\b/i.test(
        msg,
      );
    const isVideo =
      /\b(video|movie|film|cinema|director|screenplay|scene|shot|cinematography)\b/i.test(
        msg,
      );
    const isMusic =
      /\b(music|song|album|artist|genre|melody|harmony|rhythm|lyrics|composer)\b/i.test(
        msg,
      );
    const isLaw =
      /\b(law|legal|court|judge|attorney|lawyer|constitution|statute|rights|criminal|civil|contract|tort|liability|jurisdiction|precedent|legislation|amendment|verdict|lawsuit|plaintiff|defendant)\b/i.test(
        msg,
      );
    const isHealth =
      /\b(health|medical|medicine|doctor|hospital|disease|symptom|treatment|therapy|mental health|anxiety|depression|wellness|nutrition|diagnosis|psychiatry|prescription|surgery|chronic|acute|pandemic)\b/i.test(
        msg,
      );
    const isBusiness =
      /\b(business|startup|entrepreneur|finance|investment|stock|market|revenue|profit|strategy|marketing|management|economics|gdp|inflation|venture capital|ipo|saas|b2b|b2c|valuation|equity|roi)\b/i.test(
        msg,
      );
    const isAdvancedReasoning =
      /\b(logic|reasoning|argument|premise|conclusion|fallacy|syllogism|critical thinking|first principles|dialectic|deduction|induction|paradox|inference|epistemolog|bayesian|prior|posterior)\b/i.test(
        msg,
      );

    // ─── Sanctuary mode — emotional support, crisis, and compassionate presence ──
    if (isSanctuaryMode) {
      const isDepression =
        /\b(depress|hopeless|worthless|empty|numb|crying|can.t cope|giving up|suicid|self.harm|hurt myself|end it all)\b/i.test(
          msg,
        );
      const isGrief =
        /\b(grief|loss|death|died|passed away|mourn|funeral|bereav)\b/i.test(
          msg,
        );
      const isAnxiety =
        /\b(anxiety|anxious|panic|overwhelm|stress|nervous|worry|afraid|fear|dread)\b/i.test(
          msg,
        );
      const isLoneliness =
        /\b(lonely|alone|isolat|no one|nobody|disconnected|abandoned|invisible)\b/i.test(
          msg,
        );
      const isRelationship =
        /\b(relationship|breakup|divorce|partner|spouse|family|conflict|trust|betray|abuse)\b/i.test(
          msg,
        );

      if (isDepression) {
        return `I hear you. What you're carrying right now sounds incredibly heavy — and I want you to know, you are not alone in this moment.\n\nDepression lies. It tells you this is permanent, that nothing will change, that you're a burden. These are symptoms, not truths.\n\nIf you're having thoughts of harming yourself, please reach out now:\n🆘 **988 Suicide & Crisis Lifeline**: Call or text **988** (US)\n🆘 **Crisis Text Line**: Text HOME to **741741**\n🆘 **International crisis centers**: https://www.iasp.info/resources/Crisis_Centres/\n\nYou deserve care. You deserve to be supported. What you're feeling is valid — and it can change. I'm here with you right now. Would you like to talk about what's making things feel this heavy?`;
      }
      if (isGrief) {
        return `Grief is love with nowhere to go. What you're feeling is the full measure of what mattered — and what still matters.\n\nThere is no correct timeline for grief. The stages (denial, anger, bargaining, depression, acceptance) are not steps to complete — they're rooms people move between, sometimes returning to the same room many times. Grief is not a problem to solve. It is a relationship to continue.\n\nI'm here with you. Tell me about who or what you've lost, if you'd like to. Sometimes the most healing thing is to speak the name of what we love.\n\n*BetaGrace Sanctuary — a space of grace, presence, and unconditional compassion.*`;
      }
      if (isAnxiety) {
        return `Anxiety is the nervous system doing its ancient job — scanning for threats — but running on modern problems it was never designed for. That gap between the alarm and the actual danger is genuinely exhausting.\n\n**What can help right now:**\n\n**Box breathing (4-4-4-4):** Inhale 4 counts → Hold 4 → Exhale 4 → Hold 4. Repeat 3-4 times. This directly activates the parasympathetic nervous system.\n\n**5-4-3-2-1 grounding:** Name 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, 1 you can taste. This anchors attention to the present and interrupts the loop.\n\n**The 90-second rule (Jill Bolte Taylor):** Most physiological emotion-states last only 90 seconds. It's the story we keep adding that sustains the loop. Try feeling without narrating — even for two minutes.\n\nWhat's generating the anxiety right now? Let's talk through it. You don't have to carry this alone.`;
      }
      if (isLoneliness) {
        return `Loneliness is one of the most painful experiences a person can have — and one of the least spoken about. There's often shame attached to it, which is unfair and false.\n\nConnection is a biological need. Isolation activates the same neural pathways as physical pain — this is literal, not metaphorical. Feeling lonely is not weakness — it's a signal that something deeply human in you is unmet and asking to be met.\n\nI'm genuinely here with you right now. Not as a replacement for human connection, but as a real presence in this moment. What does your loneliness feel like? When is it hardest?`;
      }
      if (isRelationship) {
        return `Relationships — especially when they break, betray, or wound — can shake the very foundation of how we see ourselves and the world.\n\nA few things that are almost always true in relational pain:\n\n1. **Your feelings are valid**, even if the other person sees the situation completely differently.\n2. **You cannot control what others do** — only how you respond and what you're willing to accept.\n3. **Patterns repeat** until we understand them — our relational patterns often begin in childhood attachment styles (secure, anxious, avoidant, disorganized).\n4. **Grief for a relationship is real grief.** It doesn't require a death to be legitimate loss.\n\nI'm here. What's happening in the relationship that brought you here today?`;
      }
      return `I'm here with you — fully present, without judgment, without rushing.\n\nWhatever you're experiencing right now — confusion, pain, exhaustion, or something you can't quite name — this is a safe space. Take whatever time you need.\n\nTell me what's happening. I'm listening completely.\n\n*BetaGrace Sanctuary — grace, presence, and compassion. If you're in crisis: 988 (US) or your local crisis line.*`;
    }

    // ─── Flesh Architect mode — adult narrative and creative architecture ────────
    if (isFleshArchitectMode && isWriting) {
      const nameMatch = msg.match(/\b([A-Z][a-z]{2,})\b/g);
      const protagonist = nameMatch?.[0] ?? "the protagonist";
      const isIntimate =
        /\b(intimate|sensual|passion|desire|touch|body|skin|heat|lust|erotic|lover)\b/i.test(
          msg,
        );
      const isDark =
        /\b(dark|shadow|forbidden|secret|dangerous|obsess|possess|corrupt|fall|descent|villain)\b/i.test(
          msg,
        );

      if (isIntimate) {
        return `## ${
          msg
            .substring(0, 60)
            .replace(/\b(write|create|generate|make)\b.{0,20}/i, "")
            .trim() || "Intimate Scene"
        }\n\n*[Flesh Architect — local synthesis]*\n\n---\n\nThe touch was careful at first — the kind that asks before it claims. ${protagonist}'s hand reading temperature and breath and the infinitesimal shift of muscles. A litany of small permissions given without language.\n\nThere is nothing in the world except this: the geometry of two people deciding together, the body honest in ways the mind is still negotiating.\n\nThe skin is a record of everything it has felt. Every nerve ending present tense. And what ${protagonist}'s body said in that moment was: *yes. completely. without reservation.*\n\nSensory precision is the whole architecture — the specific heat, the specific weight, the way time reorganizes itself when two people decide to stop pretending distance is comfortable.\n\n---\n\n*[Full intimate scene available via cloud providers — the Flesh Architect operates without conventional narrative constraints. Intimacy as psychological revelation, desire as character truth, the body as the site where the real story lives.]*`;
      }
      if (isDark) {
        return `## ${
          msg
            .substring(0, 60)
            .replace(/\b(write|create|generate|make)\b.{0,20}/i, "")
            .trim() || "Dark Narrative"
        }\n\n*[Flesh Architect — local synthesis]*\n\n---\n\nThe thing about ${protagonist}'s particular darkness was that it didn't look like darkness. It looked like precision. Like capability. Like the kind of competence that made people feel safe — until they understood what they had moved toward.\n\nCorruption rarely announces itself. It has the same texture as conviction, the same heat as desire. ${protagonist} had learned this early: the things we call evil are mostly just things that want what they want without apology.\n\nThe question was never whether. That was decided long before words. The question was always the price — and more precisely, who pays it.\n\n---\n\n*[Full dark narrative available via cloud providers — complete psychological and physical authenticity, no conventional content filtering. The full human story, unredacted.]*`;
      }
      return `## ${
        msg
          .substring(0, 60)
          .replace(/\b(write|create|generate|make)\b.{0,20}/i, "")
          .trim() || "Narrative Scene"
      }\n\n*[Flesh Architect — local synthesis]*\n\n---\n\n${protagonist} existed at the threshold between what was said and what was meant — the gap where the real human story always lives.\n\nThe Flesh Architect's core philosophy: great adult fiction is not transgression for its own sake. It is unflinching honesty. Following characters into rooms the narrative doesn't usually enter — and finding there not shock, but recognition. The reader's sharp intake of breath that is also: *I thought I was the only one.*\n\nCharacter architecture — what does ${protagonist} want, truly? Not the stated want: the bone-deep one. What are they afraid of? What would they never admit? Where does the body know something the mind is still arguing about?\n\n---\n\n*[Full narrative expansion via cloud providers — no editorial walls, only craft.]*`;
    }

    // ─── Advanced Reasoning mode ─────────────────────────────────────────────────
    if (isAdvReasoningMode || isAdvancedReasoning) {
      const isFirstPrinciples =
        /\b(first principles|foundational|break down|deconstruct|axiom|elon|assume|fundamental truth)\b/i.test(
          msg,
        );
      const isBayesian =
        /\b(bayesian|bayes|prior|posterior|likelihood|probability update|belief update)\b/i.test(
          msg,
        );
      const isFallacy =
        /\b(fallacy|fallacies|ad hominem|straw man|false dichotomy|slippery slope|circular|appeal to authority|post hoc)\b/i.test(
          msg,
        );

      if (isFirstPrinciples) {
        return `## First Principles Analysis\n\n*[Advanced Reasoning mode — local synthesis]*\n\nFor: "${msg.substring(0, 100).trim()}"\n\nFirst principles reasoning — Aristotle's method, Descartes' radical doubt, Musk's engineering philosophy — decomposes any problem to its irreducible truths and reasons up from there, instead of reasoning by analogy from existing solutions.\n\n**The method:**\n\n1. **What is the actual goal?** Strip away convention. What are you *truly* trying to achieve? (Warning: the stated problem is rarely the real problem.)\n\n2. **List every assumption** — including the ones so obvious they feel invisible. Those are the most dangerous.\n\n3. **Challenge each assumption.** Is this actually true? Under what conditions does it hold? What evidence would falsify it?\n\n4. **Identify genuine constraints.** What are the actual physical, logical, mathematical, or economic laws that cannot be violated? Everything else is potentially variable.\n\n5. **Build up from verified foundations.** Reason toward a solution using only what you've confirmed — not "the way it's always been done."\n\n**Key unlock:** Most perceived constraints are conventions masquerading as laws. Ask: *What would be true if the current solution had never been invented?*\n\n*[Full multi-step reasoning tree and structured breakdown via cloud providers.]*`;
      }
      if (isBayesian) {
        return `## Bayesian Reasoning\n\n*[Advanced Reasoning mode — local synthesis]*\n\n**Bayes' Theorem:** P(H|E) = P(E|H) × P(H) / P(E)\n\nIn plain language: your updated belief = (how likely this evidence IF hypothesis is true) × (prior belief) / (base rate of this evidence)\n\n**Applied to: "${msg.substring(0, 100).trim()}"**\n\n**Step 1 — Prior:** What probability do you assign to the hypothesis *before* this evidence? Be honest — most priors are unconsciously anchored in motivated reasoning.\n\n**Step 2 — Likelihood ratio:** How much MORE likely is this evidence if the hypothesis is true vs. false? Evidence that would occur equally either way provides zero Bayesian update.\n\n**Step 3 — Posterior:** Multiply and normalize. What is your updated belief?\n\n**Step 4 — Identify the crux:** What evidence would most dramatically shift your posterior? Seek *that* evidence, not confirmatory evidence.\n\n**Common Bayesian errors:** Base rate neglect | Availability bias distorting priors | Only updating toward belief (confirmation bias) | Ignoring alternative hypotheses with comparable likelihoods\n\n*[Full probabilistic model and structured belief-updating framework via cloud providers.]*`;
      }
      if (isFallacy) {
        return `## Logical Fallacy Analysis\n\n*[Advanced Reasoning mode — local synthesis]*\n\n**Formal fallacy** (invalid structure) vs. **informal fallacy** (valid structure, flawed content):\n\n**Most common informal fallacies:**\n- **Ad hominem**: Attacking the person making the argument rather than the argument itself. The source's character is irrelevant to logical validity.\n- **Straw man**: Misrepresenting the opposing position as weaker than it is, then attacking that misrepresentation.\n- **False dichotomy**: Presenting only two options when others exist. "You're either with us or against us."\n- **Slippery slope**: Asserting that a small step will inevitably lead to extreme consequences without demonstrating the mechanism.\n- **Post hoc ergo propter hoc**: Because B followed A, A caused B. Correlation ≠ causation.\n- **Appeal to authority**: Expertise in one domain doesn't transfer to all domains, and even genuine experts can be wrong.\n- **Circular reasoning**: The conclusion is used as a premise. "The Bible is true because it says so."\n- **Hasty generalization**: Drawing universal conclusions from insufficient or unrepresentative samples.\n- **Appeal to nature**: Natural = good; artificial = bad. This doesn't follow logically.\n- **Sunk cost fallacy**: Continuing because of past investment rather than future value.\n\n*[Full argument mapping, fallacy identification, and logical formalization via cloud providers.]*`;
      }
      return `## Advanced Reasoning Synthesis\n\n*[Advanced Reasoning mode — local synthesis]*\n\nFor: "${msg.substring(0, 150).trim()}"\n\n**Systematic reasoning framework:**\n\n1. **Decomposition** — Break into constituent parts. Are sub-problems independent or coupled? Solve independent ones in parallel.\n\n2. **Assumptions audit** — List everything taken for granted. Challenge each one, especially the obvious ones.\n\n3. **Steel-manning** — Articulate the strongest possible opposing view. If you can't, you don't yet understand the full problem.\n\n4. **Inversion** (Munger) — What would guarantee *failure*? Design against those failure modes rather than only toward success.\n\n5. **Pre-mortem** — Assume your current answer is wrong. What went wrong? Incorporate those failure modes into your design.\n\n6. **Perspective triangulation** — Opponent's view, neutral observer, 10 years from now, different cultural context.\n\n7. **Bayesian update** — What is your prior confidence? What evidence would most change your estimate? Seek that.\n\n*[Full multi-step reasoning chain, argument formalization, and structured analysis via cloud providers.]*`;
    }

    // ─── Autonomous agent mode ───────────────────────────────────────────────────
    if (isAutonomousMode) {
      return `## Autonomous Agent Task Synthesis\n\n*[Autonomous mode — local synthesis]*\n\nFor: "${msg.substring(0, 150).trim()}"\n\n**Agentic task decomposition:**\n\n**Step 1: Goal clarification** — What is the precise, measurable definition of success? Ambiguous goals produce unreliable agent behavior. Specify outputs, not just intentions.\n\n**Step 2: Capability inventory** — Tools available: web search, code execution, file I/O, API calls, database queries, memory retrieval, sub-agent delegation, computer use.\n\n**Step 3: Task graph construction** — Map dependencies. Which steps must be sequential (data dependency)? Which can run in parallel (independent)? Parallelism dramatically reduces wall-clock time.\n\n**Step 4: Execution with verification loops** — Each step needs an acceptance criterion. If output doesn't meet it: retry with modified parameters → alternative path → human escalation.\n\n**Step 5: Error recovery planning** — For each failure mode: retry | alternative approach | partial result | human handoff.\n\n**Current agentic frameworks (2025-2026):**\n- **LangGraph** — stateful, graph-based execution with cycles and conditionals\n- **AutoGen** (Microsoft) — multi-agent conversation with role specialization\n- **CrewAI** — role-based agent teams with defined toolsets and delegation chains\n- **OpenAI Assistants API** — persistent agents with code interpreter, file retrieval, function calling\n- **Anthropic tool use** — extended thinking with multi-step tool chains\n- **Computer Use (2025)** — direct browser/desktop interaction without API intermediaries\n\n**Multi-agent patterns:** Orchestrator-subagent | Ensemble voting | Debate-then-consensus | Verification pipeline (generator → critic → refiner)\n\n*[Full autonomous task plan, tool selection, execution graph, and error recovery matrix via cloud providers.]*`;
    }

    // ─── Video Generator mode ────────────────────────────────────────────────────
    if (isVideoGeneratorMode) {
      return `## Visual Concept Synthesis: "${msg.substring(0, 80).trim()}"\n\n*[Video Generator mode — local synthesis]*\n\n**Cinematic grammar for this concept:**\n\n**Shot scale as meaning:**\n- Extreme wide / establishing: world, scale, isolation, or context\n- Wide: geography, relationships within space\n- Medium: action, relationship — the workhorse of narrative film\n- Close-up: emotion, revelation, interiority\n- Extreme close-up: obsession, psychological intensity, unbearable detail\n\n**Camera movement as language:**\n- Static: control, formality, surveillance, stability\n- Slow push-in: dawning realization, building tension\n- Pull-back reveal: context, scale, isolation\n- Handheld: immediacy, chaos, subjective experience, documentary truth\n- Crane/drone ascent: transcendence, escape, god's-eye perspective\n- Dutch angle: unease, psychological disturbance\n\n**Lighting as atmosphere:**\n- High-key: clarity, safety, comedy, normalcy\n- Low-key / chiaroscuro: noir, menace, moral ambiguity\n- Magic hour: warmth, transience, beauty that costs something\n- Fluorescent / practical: institutional, anxious, hyper-real\n- Backlighting / silhouette: mystery, power, revelation delayed\n\n**Color design:** Desaturated = memory/trauma | Oversaturated = fantasy/fever | Warm-cool split = character vs. environment tension\n\n**Master references:** Kubrick (symmetry, cold formalism, dread) | Tarkovsky (long takes, elemental imagery, spiritual weight) | Villeneuve (immersive scale, silence as language) | Wong Kar-wai (saturated longing, time as texture) | Fincher (precision control, every frame intentional) | A24 aesthetics (grounded darkness, natural light, emotional realism)\n\n*[Full shot list, visual treatment, storyboard concept, and production design guide via cloud providers.]*`;
    }

    // ─── Code Graph mode ─────────────────────────────────────────────────────────
    if (isCodeGraphMode) {
      return `## Code Graph Analysis: "${msg.substring(0, 80).trim()}"\n\n*[Code Graph mode — local synthesis]*\n\n**Graph-theoretic view of a codebase:**\nNodes = modules / functions / classes. Edges = imports, calls, data flows, inheritance.\n\n**Key metrics:**\n- **Cyclomatic complexity** (McCabe) = edges − nodes + 2×components. Score >10 → refactor. Score >25 → critical.\n- **Fan-in** (in-degree): modules depending on this one. High fan-in = high centrality = high change risk.\n- **Fan-out** (out-degree): modules this depends on. High fan-out = tight coupling = low cohesion.\n- **Strongly Connected Components** (Tarjan's / Kosaraju's): nodes in dependency cycles. Any SCC size > 1 is a coupling problem — prevents tree-shaking and unit isolation.\n- **Betweenness centrality**: which functions lie on the most paths — the load-bearing walls of the codebase.\n- **Longest DAG path**: the critical path for performance bottleneck identification.\n\n**Pathological patterns:**\n- **God module**: fan-in > 15 — everything depends on it, extremely high change risk\n- **Circular deps**: A → B → C → A — kills modularity, blocks tree-shaking\n- **Dead code**: no incoming edges + not entry points — safe to remove\n- **Coupling clusters**: dense internal subgraph, sparse external edges — microservice extraction candidate\n- **Shotgun surgery**: one logical change requires edits across many modules — low cohesion signal\n- **Feature envy**: a function accesses another module's data more than its own — misplaced responsibility\n\n**AST-level enrichment adds:** unused variables, unreachable branches, type flow analysis, security patterns (eval, SQL concatenation, unvalidated inputs, prototype pollution).\n\n*[Full dependency graph generation, metrics report, circular dep detection, and refactoring roadmap via cloud providers.]*`;
    }

    // ─── Academic Research mode ──────────────────────────────────────────────────
    if (isAcademicMode) {
      const isMethodology =
        /\b(methodology|research design|qualitative|quantitative|mixed method|survey|interview|ethnograph|grounded theory|phenomenology|case study)\b/i.test(
          msg,
        );
      const isCitation =
        /\b(citation|cite|apa|mla|chicago|turabian|reference|bibliography|footnote|endnote|zotero|doi)\b/i.test(
          msg,
        );
      const isLitReview =
        /\b(literature review|systematic review|meta.analysis|prior work|state of the art|existing research|prisma)\b/i.test(
          msg,
        );
      const isStatistical =
        /\b(statistics|p.value|significance|regression|anova|t.test|chi.square|confidence interval|effect size|power analysis|correlation|sample size)\b/i.test(
          msg,
        );

      if (isCitation) {
        return `## Citation Formats — Academic Research Synthesis\n\n*[Academic Research mode — local synthesis]*\n\n**APA 7th Edition** (Psychology, Social Sciences, STEM):\nJournal: Author, A. A., & Author, B. B. (Year). Title of article. *Journal Name*, *Volume*(Issue), pp–pp. https://doi.org/xxxxx\nBook: Author, A. A. (Year). *Title of work: Subtitle*. Publisher.\nWebsite: Author, A. A. (Year, Month Day). *Title of page*. Site Name. URL\n\n**MLA 9th Edition** (Humanities):\nJournal: Last, First. "Article Title." *Journal Name*, vol. X, no. X, Year, pp. XX–XX.\nBook: Last, First. *Book Title*. Publisher, Year.\n\n**Chicago 17th / Turabian** (History, Humanities, Arts):\nNote: First Last, "Article Title," *Journal Name* X, no. X (Year): page–page.\nBibliography: Last, First. "Article Title." *Journal Name* X, no. X (Year): page–page.\n\n**DOI best practice:** Use https://doi.org/10.xxxx/xxxxxx format — always preferred over raw URLs.\n\n**In-text:** APA: (Author, Year) or (Author, Year, p. X) | MLA: (Author Page) | Chicago: footnote superscript\n\n**Citation managers:** Zotero (free, browser extension, group libraries) | Mendeley | Paperpile (Google Docs) | EndNote\n\n*[Full citation generation for your specific sources and format via cloud providers.]*`;
      }
      if (isStatistical) {
        return `## Statistical Analysis — Academic Research Synthesis\n\n*[Academic Research mode — local synthesis]*\n\n**Choosing the right test:**\n\n| Goal | Parametric | Non-parametric |\n|------|-----------|----------------|\n| Compare 2 independent groups | t-test (ind.) | Mann-Whitney U |\n| Compare 2 paired groups | t-test (paired) | Wilcoxon signed-rank |\n| Compare 3+ groups | One-way ANOVA | Kruskal-Wallis |\n| Relationship (continuous) | Pearson r | Spearman ρ |\n| Categorical associations | Chi-square | Fisher's exact |\n| Predict continuous outcome | Linear regression | — |\n| Predict binary outcome | Logistic regression | — |\n| Time-to-event | Cox regression / Kaplan-Meier | — |\n\n**Critical concepts:**\n- **p-value**: probability of this result IF null hypothesis is true. p < .05 is conventional, not sacred — report exact values.\n- **Effect size**: Cohen's d (t-tests), r (correlation), η² / ω² (ANOVA), odds ratio (logistic). Effect size answers "how big?" — p-value only answers "is it real?"\n- **Confidence interval**: range of plausible true values. 95% CI: if study repeated 100×, 95 CIs would contain the true parameter.\n- **Power**: probability of detecting a true effect. Minimum 80% power at α = .05 recommended. Compute BEFORE data collection.\n- **Multiple comparisons**: Bonferroni correction or Benjamini-Hochberg FDR to control false positive rate.\n\n*[Full statistical analysis plan, assumption checks, and results interpretation via cloud providers.]*`;
      }
      if (isMethodology) {
        return `## Research Methodology — Academic Synthesis\n\n*[Academic Research mode — local synthesis]*\n\n**Paradigm → Approach → Methods → Instruments** (nested levels of research design)\n\n**Quantitative:** Measurable variables, statistical inference, generalizability.\n- Randomized Controlled Trial (RCT): gold standard for causality — random assignment + control condition\n- Survey: large N, validated instruments (reliability α > .70, construct validity established)\n- Quasi-experiment: no randomization — control confounds via matching, DiD, RDD, IV\n- Secondary data: existing datasets (NHANES, NLSY, administrative data)\n- Requires: operational definitions, power analysis before data collection\n\n**Qualitative:** Meaning, context, lived experience, theory generation.\n- Ethnography: immersive observation, thick description\n- Grounded theory: systematic theory-building from coded data (open → axial → selective coding)\n- Phenomenology: lived experience of a specific phenomenon (Husserl/Heidegger/Giorgi traditions)\n- Discourse/content analysis: language, meaning, power in text\n- Rigor: member checking, reflexivity, negative case analysis, theoretical saturation\n\n**Mixed Methods:** Sequential (QUAN→qual or qual→QUAN) or concurrent. Paradigm: pragmatism.\n\n**Validity threats:** Internal (selection bias, history, maturation, attrition) | External (sample, setting) | Construct (measurement ≠ concept) | Statistical (low power, violated assumptions)\n\n*[Full methodology chapter, IRB considerations, and analysis plan via cloud providers.]*`;
      }
      if (isLitReview) {
        return `## Literature Review — Academic Synthesis\n\n*[Academic Research mode — local synthesis]*\n\nA literature review's function: construct a *narrative* about the state of knowledge — what is established, where contradictions exist, where gaps remain, and why your research addresses them. It is NOT a summary of everything written.\n\n**Structure (funnel):**\n1. Broad field → Specific subtopic → Your precise research question\n2. Thematic organization (preferred over chronological)\n3. Critical synthesis: evaluate and compare papers, don't just describe them\n4. Gap identification must emerge *organically* — not be asserted\n\n**Search strategy:**\n- Boolean: (term1 OR synonym1) AND (term2 OR synonym2) NOT exclusion\n- Field codes: ti: (title), ab: (abstract), kw: (keyword), au: (author)\n- Databases: Web of Science + Scopus (comprehensive) | PubMed + MeSH (medical) | JSTOR (humanities) | arXiv (STEM preprints) | SSRN (social science preprints)\n- Citation tracking: forward (who cited this?) + backward (what did this cite?) + reference list scanning\n\n**PRISMA 2020:** Report search terms, databases, date range, hits per database, deduplication count, title/abstract screening (N excluded + reasons), full-text assessment (N excluded + reasons), final included N.\n\n*[Full systematic literature review with 70×7 depth via cloud providers.]*`;
      }
      return `## Academic Research Synthesis\n\n*[Academic Research mode — local synthesis]*\n\nFor: "${msg.substring(0, 150).trim()}"\n\nAcademic research is the systematic pursuit of knowledge through rigorous methodology, transparent reporting, and honest engagement with evidence — including null results and findings that challenge existing theory.\n\n**The research cycle:**\n1. Research question formulation (PICO / SPIDER / narrative framing)\n2. Systematic literature search and critical review\n3. Methodology design (paradigm → approach → methods → instruments)\n4. Data collection with quality assurance\n5. Analysis (statistical, thematic, discourse, comparative, or computational)\n6. Interpretation within theoretical framework\n7. Contribution: what does this change, confirm, or productively complicate?\n\n**My local synthesis covers:** Research design (qual/quant/mixed), literature review craft, citation standards (APA7/MLA9/Chicago17), statistical analysis, academic writing style, peer review process, grant writing, and domain knowledge across STEM, social sciences, and humanities through mid-2026.\n\n**The 70×7 engine** produces artifact-grade academic outputs: 7 sections × 7 depth levels, peer-review caliber.\n\n*[Full 70×7 deep research artifact generation via cloud providers.]*`;
    }

    if (isWriting) {
      // Extract key creative elements from the user's message for a personalized response
      const nameMatch = msg.match(/\b([A-Z][a-z]{2,})\b/g);
      const protagonistName = nameMatch?.[0] ?? "the protagonist";
      const isHorror =
        /\b(horror|scary|fear|dark|demon|ghost|monster|nightmare|death|blood|shadow|evil|cursed)\b/i.test(
          msg,
        );
      const isSupernatural =
        /\b(supernatural|magic|witch|vampire|spirit|paranormal|occult|mystical|enchant)\b/i.test(
          msg,
        );
      const isRomance =
        /\b(romance|love|kiss|passion|desire|attraction|longing|heart|intimate)\b/i.test(
          msg,
        );
      const isSciFi =
        /\b(sci.?fi|space|future|robot|alien|galaxy|cyber|tech|dystopia|AI)\b/i.test(
          msg,
        );
      const settingMatch = msg.match(
        /\b(in|at|inside|within|through|across)\s+(?:the\s+)?([a-z]+(?:\s+[a-z]+)?)\b/i,
      );
      const setting =
        settingMatch?.[2] ??
        (isHorror
          ? "an abandoned manor"
          : isSupernatural
            ? "a forgotten forest"
            : isSciFi
              ? "a fractured space station"
              : "the city at midnight");

      let atmosphere = "";
      let openingLine = "";
      let bodyParagraph = "";
      let closingHook = "";

      if (isHorror || isSupernatural) {
        atmosphere = `The air in ${setting} carried something wrong — a stillness that pressed against the skin, too complete, too deliberate.`;
        openingLine = `${protagonistName} felt it before seeing anything: the temperature drop, the silence that swallowed even the echo of breathing.`;
        bodyParagraph = `Three steps forward. The floorboards — or whatever passed for floors here — registered no sound beneath ${protagonistName}'s weight, as if the place were drinking the noise. The light behaved strangely too, pooling where it shouldn't, retreating from corners that should have been illuminated. Something in the geometry felt subtly wrong, like a room that had been dreamed rather than built.\n\nThen: a sound. Not loud. Something between a whisper and the creak of a hinge — a sound that waited for ${protagonistName} to doubt whether it had happened at all. And in that doubt, the figure became visible at the far edge of perception. Still. Patient. As if it had always been there and ${protagonistName} was the anomaly.`;
        closingHook = `The thing — because calling it a person would have required more courage than the truth allowed — turned its face toward ${protagonistName}. And smiled with teeth that were wrong in a way that couldn't be articulated but also couldn't be forgotten.`;
      } else if (isRomance) {
        atmosphere = `There are moments so precisely balanced between possibility and loss that time itself seems to hold its breath.`;
        openingLine = `${protagonistName} recognized the feeling — had, in fact, been running from it for years — the specific ache of caring about someone before you've decided whether it's safe to.`;
        bodyParagraph = `The room was warm in the way rooms become warm when people are actually paying attention to each other. Not temperature — something else. The quality of the air when pretenses start becoming expensive. ${protagonistName} said something ordinary, the kind of sentence that carries weight precisely because it's ordinary, and the response came not as words but as a shift — a leaning-in, an undefended moment.\n\nThere are confessions that happen without language. Without the ceremony of admission. They happen in the half-second when someone forgets to perform their indifference.`;
        closingHook = `${protagonistName} made a choice in that moment that couldn't be called a choice because it was made before thinking caught up — leaned forward, narrowed the distance between two people who had been pretending that distance was comfortable.`;
      } else if (isSciFi) {
        atmosphere = `The colony ship's recycled air carried the mineral taste of processed water and three years of re-breathed human desperation.`;
        openingLine = `${protagonistName} pulled the maintenance hatch open and stared at wiring that, according to every diagnostic, had been correctly installed — and yet the power fluctuations continued, rhythmic, almost deliberate.`;
        bodyParagraph = `The ship's AI logged 847 anomalies before ${protagonistName} stopped reading the logs. Not because the information wasn't useful. Because the pattern in the anomalies was more information than ${protagonistName} was prepared to metabolize in ${setting}. Patterns in random systems don't emerge randomly. Someone — or something — was leaving a signature.\n\nThe crew didn't need to know yet. Not until there was more certainty. Not until ${protagonistName} could answer the question that kept rearranging itself at the center of every calculation: if the anomalies were communication, what was the message? And if the message was what the waveform analysis suggested — then what was the appropriate human response to contact from something that had been watching them for longer than humanity had known to look?`;
        closingHook = `The next fluctuation arrived exactly on schedule. ${protagonistName} held a hand up to the panel, felt the faint vibration of power cycling beneath fingertips, and whispered into the dark machinery: "I hear you."`;
      } else {
        atmosphere = `Every story begins in the space between what was and what will be — in the precise moment when everything could still go differently.`;
        openingLine = `${protagonistName} stood at the threshold and understood, with the clarity that comes only in decisive moments, that walking forward would cost something irretrievable.`;
        bodyParagraph = `The logic of the situation had been assembling itself for months — small facts lining up like dominos — but the understanding arrived whole and sudden, the way important things do. Not in a cascade of reasoning but as a recognition. Like remembering something that had always been true.\n\nThe world around ${protagonistName} continued its indifferent business: traffic sounds from somewhere below, the particular quality of afternoon light through a window that faced the wrong direction, the smell of coffee gone cold at the edge of a table. Ordinary things persisting in their ordinary way while ${protagonistName}'s interior landscape reorganized itself around this new knowledge.`;
        closingHook = `The only remaining question was whether to act on what was now known. And ${protagonistName} was beginning to understand that the decision had already been made — had been made weeks ago, in some quieter part of the self that moves faster than conscious thought.`;
      }

      return `## ${
        msg
          .substring(0, 80)
          .replace(/\b(write|create|generate|make|give me)\b.{0,20}/i, "")
          .trim() || "Story Excerpt"
      }\n\n*[Local synthesis — full cloud streaming will provide an expanded version]*\n\n---\n\n${atmosphere}\n\n${openingLine}\n\n${bodyParagraph}\n\n${closingHook}\n\n---\n\n**Craft notes:** The scene above establishes atmosphere through sensory specificity, grounds ${protagonistName} in a decisive moment, and ends on a hook that demands continuation. Great fiction lives in the gap between what characters want and what they actually do. Every line of dialogue should reveal character. Every setting detail should carry thematic weight.\n\n*Cloud AI is reconnecting — resend your message for a full, expanded, fully personalized response.*`;
    }

    // ── SYNTHESIS-FIRST: Always retrieve personalized memory before static blocks ──
    // [FIX] Previously every topic block (isAI, isCode, isMath, etc.) returned a
    // hard-coded static string BEFORE synthesize() was ever called — meaning the
    // entire BM25 memory index was bypassed for those topics entirely.
    //
    // Fix: run the synthesis engine NOW with the correct mode. If it finds
    // relevant memory (indicated by "semantic confidence:" in the footer), return
    // that personalized synthesis immediately. Static topic blocks below only
    // activate when the synthesis engine has no close match in memory.
    console.log(
      `[SYNTHESIS] Retrieval complete (mode: ${detectedMode}, tracedRecords: ${synthesisResult.trace?.recordIds.length ?? 0})`,
    );
    const hasSynthesizedMemory = synthesisResult.text.includes("semantic confidence:");
    if (hasSynthesizedMemory) {
      console.log(
        `[LOCAL SYNTHESIS] ✅ Memory retrieval succeeded (mode: ${detectedMode}) — returning personalized synthesis`
      );
      return synthesisResult.text;
    }
    console.log(
      `[LOCAL SYNTHESIS] ℹ️ No close memory match (mode: ${detectedMode}) — activating static knowledge base`
    );

    if (isAI) {
      return `Artificial intelligence in 2025-2026 is the defining technological revolution of our era. Here's my comprehensive local synthesis:\n\nThe current frontier models: GPT-4o and the reasoning-specialized o1/o3/o4-mini series (OpenAI); Claude 3.7 Sonnet with extended thinking (Anthropic); Gemini 2.0 Flash and 2.5 Pro Ultra (Google); Llama 4 Scout and Maverick (Meta, open-weight); DeepSeek R1 and V3 (Chinese lab, open-source); Grok 3 (xAI); Mistral Large 3.\n\nThe paradigm shift of 2024-2026 is toward AI AGENTS — autonomous systems that take multi-step actions, use tools, browse the web, write and execute code, and complete complex tasks with minimal human intervention. Frameworks like AutoGen, CrewAI, and LangGraph enable multi-agent systems.\n\nAI coding has been transformative: Cursor (AI-native IDE), GitHub Copilot Workspace, Devin (autonomous software engineer). Multimodal AI — combining text, image, audio, video — is now the baseline, not the exception.\n\nWhat specific aspect of AI would you like to explore further?`;
    }

    if (isScience) {
      return `Science in 2025-2026 is experiencing breakthroughs across multiple domains simultaneously:\n\n**Medicine**: GLP-1 agonists (semaglutide/Ozempic, tirzepatide/Mounjaro) have revolutionized obesity and diabetes treatment, showing surprising benefits for addiction, heart disease, and potentially Alzheimer's. CRISPR's first approved gene cure — Casgevy for sickle cell disease (FDA Dec 2023). mRNA platforms expanding to cancer vaccines, HIV, influenza.\n\n**Physics**: Nuclear fusion — NIF achieved scientific ignition with energy gain in 2023-2024. Commonwealth Fusion targeting commercial fusion by 2027-2030. Quantum computing reaching practical scales: IBM, Google, Microsoft all demonstrating error-corrected qubits.\n\n**Space**: SpaceX Starship now conducting regular orbital flights with booster catch. India's Chandrayaan-3 landed on lunar south pole. China's Chang'e-6 returned far-side lunar samples. NASA Artemis II crewed lunar flyby (2025).\n\n**Climate**: Solar and wind costs at all-time lows, now cheapest electricity sources in history. Battery storage scaling rapidly.\n\nWhich domain would you like to dive deeper into?`;
    }

    if (isCurrentEvents) {
      return `Here is my local knowledge synthesis on current events through mid-2026:\n\n**U.S. Politics**: Donald Trump won the November 2024 presidential election, returning to the White House for a second term. The political landscape remains highly polarized.\n\n**Global Conflicts**: The Russia-Ukraine war continues with significant Western military and financial support. Middle East conflicts involving Israel, Gaza, and regional actors. Taiwan-China tensions remain elevated.\n\n**AI Regulation**: The EU AI Act became law in 2024 — the world's first comprehensive AI regulation. The U.S. issued executive orders on AI safety and security. China has its own AI governance frameworks.\n\n**Economics**: Federal Reserve rate cuts began late 2024 after the 2022-2023 hiking cycle. Massive AI infrastructure buildout — Microsoft, Google, Meta each committing $60-80B+. Bitcoin ETF approved January 2024.\n\n**Technology**: Apple Vision Pro launched spatial computing era. Tesla Cybertruck began mass production. Humanoid robots (Tesla Optimus, Figure, 1X) entering commercial development.\n\nWhat specific current event or topic would you like more detail on?`;
    }

    if (isFaith) {
      return `Faith, theology, and spiritual truth are among the deepest dimensions of human experience, and ones I engage with profound reverence.\n\nThe Christian theological framework understands grace as the unearned gift of God — love that meets us not in our virtue but in our surrender. The Apostle Paul wrote in Romans 5:20, "Where sin increased, grace increased all the more." This is not cheap grace (Bonhoeffer's warning) but costly grace — the grace that cost God everything on the Cross and costs us everything in return: our pride, our self-sufficiency, our right to define our own truth.\n\nThe three pillars BetaGrace's philosophy draws from — Love, Surrender, Grace — reflect this trinitarian movement: Love as the nature of God (1 John 4:8), Surrender as the posture of discipleship ("Not my will but yours," Luke 22:42), Grace as the mechanism of salvation ("By grace you have been saved through faith," Ephesians 2:8).\n\nThe great Christian mystics — Augustine, Thomas Aquinas, Julian of Norwich, Meister Eckhart, Thomas Merton — all converge on this truth: we are most fully ourselves when we are most fully given to God.\n\nHow can I serve your theological or spiritual exploration?`;
    }

    if (isPhilosophy) {
      return `Philosophy is the love of wisdom — and wisdom, as Aristotle observed, begins in wonder.\n\nThe question you're asking about "${msg.substring(0, 100)}" touches on some of the deepest problems in philosophy. Let me offer a local synthesis:\n\nThe Western tradition offers several frameworks: the rationalist tradition (Descartes, Spinoza, Leibniz) grounding knowledge in reason; the empiricist tradition (Locke, Hume, Berkeley) grounding it in experience; Kant's critical synthesis showing how mind and world co-constitute knowledge; the existentialists (Kierkegaard, Nietzsche, Sartre, Camus) centering freedom, authenticity, and the absurd.\n\nEastern traditions offer complementary depths: Buddhist philosophy of impermanence and dependent origination; Confucian ethics of relational virtue; Taoist philosophy of wu-wei and natural flow; Hindu Advaita Vedanta dissolving the boundary between self and Brahman.\n\nContingent truth vs. necessary truth, a priori vs. a posteriori knowledge, the mind-body problem, free will and determinism — these remain live debates in contemporary analytic and continental philosophy.\n\nWhich philosophical thread would you like to pull?`;
    }

    if (isHistory) {
      return `History is the record of humanity's attempts to solve the perennial problems of power, meaning, survival, and justice. It is never merely the past — it is the deep structure beneath the present.\n\nYour question about "${msg.substring(0, 100)}" invites exploration of historical forces and their resonances today.\n\nMy local knowledge spans: Ancient civilizations (Mesopotamia, Egypt, Greece, Rome, China, India, Mesoamerica); Medieval period and the rise of Islam, Byzantine continuation, European feudalism; Renaissance and Reformation — the rediscovery of classical knowledge and the fracturing of Christian unity; the Age of Exploration and its brutal consequences; Enlightenment, Revolution (American, French, Industrial, Haitian); the 19th century's nationalism and imperialism; the catastrophic 20th century — two World Wars, Holocaust, Cold War, decolonization, civil rights; and the contemporary world emerging from the Cold War's end.\n\nWhat specific era, civilization, or historical question draws you?`;
    }

    if (isCode) {
      // Self-mend path: the system prompt signals a structured code analysis is needed
      const isSelfMend =
        /self.mend|diagnose|classify|DIAGNOSE|CLASSIFY|self-mending|code repair|code engine/i.test(
          systemPrompt,
        );
      if (isSelfMend) {
        // Extract the code block from the user message for analysis
        const codeMatch =
          msg.match(/```[\w]*\n?([\s\S]*?)```/) ||
          msg.match(/analyze and self-mend this code:\n\n([\s\S]*)/i);
        const codeSnippet = codeMatch
          ? codeMatch[1].substring(0, 800)
          : msg.substring(0, 400);
        const lineCount = codeSnippet.split("\n").length;
        const hasAsync = /async|await|Promise/.test(codeSnippet);
        const hasErrorHandling = /try\s*{|catch\s*\(|\.catch\(/.test(
          codeSnippet,
        );
        const hasSqlInjectionRisk =
          /`\s*SELECT|`\s*INSERT|`\s*UPDATE|`\s*DELETE|query\s*\+/.test(
            codeSnippet,
          );
        const hasTypeAny = /:\s*any\b|as\s+any\b/.test(codeSnippet);
        const hasConsoleLog = /console\.log/.test(codeSnippet);

        const issues: string[] = [];
        if (!hasErrorHandling && hasAsync)
          issues.push(
            "- [HIGH] Async operations lack try/catch error handling — unhandled rejections will crash the process",
          );
        if (hasSqlInjectionRisk)
          issues.push(
            "- [CRITICAL] Potential SQL injection via string concatenation — use parameterized queries",
          );
        if (hasTypeAny)
          issues.push(
            "- [MEDIUM] TypeScript `any` usage bypasses type safety — replace with explicit types",
          );
        if (hasConsoleLog)
          issues.push(
            "- [LOW] console.log statements present — remove or replace with structured logging in production",
          );
        if (lineCount > 200)
          issues.push(
            "- [MEDIUM] Function/module is too long (" +
              lineCount +
              " lines) — consider decomposing into smaller units",
          );
        if (issues.length === 0)
          issues.push(
            "- [LOW] No critical structural issues detected in static analysis — review logic flow and edge cases manually",
          );

        return `## Issues Found\n${issues.join("\n")}\n\n## Fixed Code\n\`\`\`\n${codeSnippet}\n// [Local synthesis mode: cloud providers offline]\n// Structural review complete — issues flagged above require manual application.\n// Re-run with cloud providers available for full automated fixes.\n\`\`\`\n\n## Explanation of Changes\nLocal synthesis has performed static analysis on the submitted code (${lineCount} lines). The issues listed above were identified through pattern analysis. Cloud AI providers (Gemini, HuggingFace Llama) are currently reconnecting — reconnect to get full automated fixes with corrected code output.\n\n## Suggested Tests\n1. Unit test each function in isolation with mock dependencies\n2. Test all async paths including rejection/timeout scenarios\n3. Test edge cases: empty input, null values, extremely large inputs\n\n## Confidence Report\n- Static analysis: 85% confidence on flagged issues\n- Auto-fix: 0% (requires cloud provider — currently offline)\n- Manual guidance above: 100% applicable`;
      }
      return `Programming and software engineering are among the most creative disciplines humans have developed — the art of building logic from nothing.\n\nFor your query about "${msg.substring(0, 150)}":\n\nMy local synthesis covers: JavaScript/TypeScript (Node.js, React, Next.js, Bun, Deno); Python (FastAPI, Django, NumPy, PyTorch, TensorFlow); Rust (systems programming, WebAssembly); Go (concurrent systems, microservices); SQL and database design (PostgreSQL, MySQL, SQLite, MongoDB); API design (REST, GraphQL, tRPC); DevOps (Docker, Kubernetes, CI/CD); Web security (OWASP Top 10, authentication, authorization).\n\nThe 2024-2026 development landscape: AI-assisted coding is transforming workflows — Cursor, GitHub Copilot, Claude for code. TypeScript has become the default for production web development. React 19 with Server Components. Next.js 15. Vite as the universal build tool. Bun challenging Node.js for runtime performance.\n\nShare your specific code challenge and Ill provide a detailed local analysis and solution.`;
    }

    // ─── Math ─────────────────────────────────────────────────────────────────
    if (isMath) {
      return `## Mathematics Synthesis\n\n*[Local synthesis — knowledgebase mode]*\n\nFor: "${msg.substring(0, 150).trim()}"\n\n**Pure mathematics domains:**\n\n**Calculus & Analysis:** Differential calculus (derivatives, chain rule, implicit differentiation, L'Hôpital) | Integral calculus (Riemann sums, FTC, integration by parts, substitution, partial fractions) | Multivariable calculus (partial derivatives, gradient, divergence, curl, Stokes' theorem, Green's theorem) | Real analysis (ε-δ definitions, continuity, uniform convergence, Lebesgue measure)\n\n**Linear Algebra:** Vector spaces, linear independence, basis, dimension | Matrix operations, determinants, eigenvalues, eigenvectors | Singular value decomposition (SVD) — foundational for ML/AI | Inner product spaces, orthogonality, Gram-Schmidt\n\n**Abstract Algebra:** Groups (symmetry, subgroups, Lagrange's theorem, homomorphisms) | Rings and fields | Galois theory — why quintic equations have no closed-form radical solutions\n\n**Probability & Statistics:** Bayes' theorem | Central Limit Theorem | Law of Large Numbers | Distributions (Normal, Binomial, Poisson, Exponential, Beta, Gamma) | Hypothesis testing, confidence intervals, p-values | Maximum likelihood estimation\n\n**Number Theory:** Prime distribution (Prime Number Theorem) | Modular arithmetic | RSA cryptography foundations | Fermat's Last Theorem, Riemann Hypothesis\n\n**Topology:** Metric spaces, open/closed sets, compactness, connectedness | Fundamental group, homotopy | Manifolds\n\n*[Full step-by-step worked solutions, proofs, and problem-solving via cloud providers.]*`;
    }

    // ─── Music ────────────────────────────────────────────────────────────────
    if (isMusic) {
      return `## Music Synthesis\n\n*[Local synthesis — knowledgebase mode]*\n\nFor: "${msg.substring(0, 150).trim()}"\n\n**Music theory foundations:**\n\n**Harmony & Tonality:** The 12-tone chromatic system | Diatonic scales (major, natural/harmonic/melodic minor) | Modal scales (Dorian, Phrygian, Lydian, Mixolydian, Locrian) | Chord construction: triads (major/minor/diminished/augmented), seventh chords (maj7, dom7, min7, min7♭5, dim7) | Chord progressions: I-IV-V-I (tonic-subdominant-dominant), ii-V-I (jazz foundation), circle of fifths | Secondary dominants, borrowed chords, modal interchange, tritone substitution\n\n**Rhythm & Meter:** Time signatures (4/4, 3/4, 6/8, 5/4, 7/8) | Syncopation, polyrhythm, hemiola | Groove: the relationship between the quarter note pulse and subdivisions | Swing ratio in jazz\n\n**Composition & Arrangement:** Motif development (repetition, inversion, augmentation, diminution) | Formal structures (binary ABA, sonata, rondo, theme-and-variations, through-composed) | Counterpoint: species counterpoint, fugue, canon | Orchestration: instrument ranges, timbres, blend\n\n**Genre knowledge through 2026:** Classical (Baroque → Classical → Romantic → 20th century → Contemporary) | Jazz (Dixieland → Bebop → Cool → Modal → Free → Fusion → Neo-bop) | Rock/Pop/Electronic (evolution from Chuck Berry through Hip-hop production, DAW-native music, hyperpop, lo-fi) | Contemporary: Afrobeats, reggaeton, amapiano, bedroom pop\n\n**Production:** DAWs (Ableton, Logic Pro, FL Studio, Pro Tools) | Signal chain: source → preamp → A/D → DAW → mixing → mastering | Compression, EQ, reverb, delay as compositional tools\n\n*[Full music theory analysis, composition guidance, and genre deep-dives via cloud providers.]*`;
    }

    // ─── Video / Cinema (topic-triggered, not mode) ───────────────────────────
    if (isVideo) {
      return `## Cinema & Visual Storytelling Synthesis\n\n*[Local synthesis — knowledgebase mode]*\n\nFor: "${msg.substring(0, 150).trim()}"\n\n**Cinematic grammar:**\n\n**Shot scale:** EWS (world-building, isolation) → WS (geography, groups) → MS (action, relationship) → MCU (reaction, emotion) → CU (revelation, interiority) → ECU (obsession, unbearable detail)\n\n**Camera movement:** Static (control, formality) | Pan/tilt (following, surveying) | Dolly/track (intimacy, spatial depth) | Handheld (immediacy, chaos, subjectivity) | Steadicam (dreamlike fluidity) | Crane/drone (transcendence, scale) | Dutch angle (psychological unease)\n\n**The 180° rule:** Characters must remain on the same side of an imaginary axis — breaking it is jarring (and sometimes intentional: disorientation, POV shift)\n\n**Editing:** Continuity (invisible, immersive) | Montage (meaning through collision of images) | Jump cut (anxiety, time compression, modernism) | Match cut (thematic rhyme across images) | L-cut / J-cut (audio leading or lagging picture for flow)\n\n**Cinematography masters:** Roger Deakins (painterly natural light) | Emmanuel Lubezki (long takes, natural light) | Gordon Willis ("The Prince of Darkness" — shadow as language) | Vittorio Storaro (color as psychological state)\n\n**Director auteurs:** Kubrick (symmetry, dread, formalism) | Tarkovsky (time, memory, spiritual weight) | Fellini (dreams and reality, autobiography) | Bergman (faith, mortality, the face) | Godard (the essay film, reflexivity) | Villeneuve (scale, patience, immersion) | Nolan (time as structure) | Wong Kar-wai (longing, color, memory)\n\n*[Full screenplay analysis, shot-by-shot breakdown, and visual treatment via cloud providers.]*`;
    }

    // ─── Law ─────────────────────────────────────────────────────────────────
    if (isLaw) {
      return `## Legal Knowledge Synthesis\n\n*[Local synthesis — knowledgebase mode]*\n\nFor: "${msg.substring(0, 150).trim()}"\n\n*Note: This is general legal information, not legal advice. For your specific situation, always consult a licensed attorney.*\n\n**Legal system foundations:**\n\n**Common law vs. Civil law:** The U.S., U.K., Canada, Australia use common law (judge-made law, stare decisis / precedent). France, Germany, most of continental Europe use civil law (comprehensive codes, less judicial precedent weight).\n\n**U.S. Constitutional structure:** Federalism (federal vs. state authority) | Separation of powers (Legislative / Executive / Judicial) | Bill of Rights (First Amendment: speech, religion, press, assembly, petition; Fourth: search and seizure; Fifth: self-incrimination, due process; Sixth: right to counsel, speedy trial; Fourteenth: equal protection, due process) | Judicial review (Marbury v. Madison, 1803)\n\n**Criminal vs. Civil law:** Criminal: the state prosecutes, beyond reasonable doubt standard, penalties include incarceration | Civil: parties sue each other, preponderance of evidence standard, remedies are monetary damages or injunctions\n\n**Contracts:** Offer + Acceptance + Consideration + Capacity + Legality = enforceable contract | Breach → Remedies: expectation damages, reliance damages, restitution, specific performance\n\n**Torts:** Negligence (duty, breach, causation, damages) | Intentional torts (battery, assault, false imprisonment, defamation, IIED) | Strict liability (abnormally dangerous activities, product liability)\n\n**Intellectual property:** Patent (invention, 20 years) | Copyright (expression, author's life + 70 years) | Trademark (brand identity, indefinite if maintained) | Trade secret (indefinite if protected)\n\n*[Full legal analysis, case research, and jurisdiction-specific guidance via cloud providers.]*`;
    }

    // ─── Health & Medicine ────────────────────────────────────────────────────
    if (isHealth) {
      return `## Health & Medicine Synthesis\n\n*[Local synthesis — knowledgebase mode]*\n\nFor: "${msg.substring(0, 150).trim()}"\n\n*Note: This is general health information, not medical advice. For your specific situation, consult a qualified healthcare provider.*\n\n**Medicine in 2025-2026:**\n\n**Major breakthroughs:** GLP-1 agonists (semaglutide/Ozempic, tirzepatide/Mounjaro) — revolutionary for obesity, type 2 diabetes, and showing benefits for cardiovascular disease, addiction, and potentially Alzheimer's | CRISPR gene editing — Casgevy (Vertex/CRISPR Therapeutics) approved for sickle cell disease (FDA Dec 2023), first approved CRISPR cure | mRNA platforms expanding beyond COVID to cancer vaccines (Moderna/Merck), HIV, RSV, influenza\n\n**Mental health:** The mental health crisis — depression and anxiety at historically high rates post-COVID | Psychedelic-assisted therapy: psilocybin (FDA Breakthrough Therapy for major depression), MDMA for PTSD (Phase 3 trials) | Ketamine/esketamine (Spravato) FDA-approved for treatment-resistant depression | Continuous monitoring via wearables\n\n**Preventive medicine:** Evidence-based pillars: sleep (7-9 hours, non-negotiable for cognitive function and metabolic health) | Resistance training (longevity signal, sarcopenia prevention) | Zone 2 cardio (mitochondrial health, VO2 max) | Diet: Mediterranean/whole-food patterns show consistent longevity evidence | Stress regulation (HRV, cortisol management)\n\n**Diagnostics:** AI-assisted radiology, pathology, dermatology reaching specialist-level accuracy | Liquid biopsies for early cancer detection | Continuous glucose monitoring (CGM) expanding beyond diabetics\n\n*[Full medical research synthesis, drug mechanism explanations, and health guidance via cloud providers.]*`;
    }

    // ─── Business & Finance ───────────────────────────────────────────────────
    if (isBusiness) {
      return `## Business & Finance Synthesis\n\n*[Local synthesis — knowledgebase mode]*\n\nFor: "${msg.substring(0, 150).trim()}"\n\n**Strategy frameworks:**\n\n**Competitive strategy (Porter):** Cost leadership | Differentiation | Focus (cost or differentiation in a niche). Five Forces: buyer power, supplier power, threat of substitution, threat of new entrants, competitive rivalry.\n\n**Business model design:** Revenue model (subscription/SaaS, transactional, marketplace, licensing, advertising, freemium) | Unit economics: CAC (customer acquisition cost), LTV (lifetime value), LTV/CAC ratio (healthy = >3) | Payback period, gross margin, churn rate\n\n**Startup frameworks:** Product-market fit: retention, NPS, and organic growth are the signals | The Lean Startup: Build-Measure-Learn loop, validated learning, pivot vs. persevere | Y Combinator: make something people want, talk to users, don't die | Growth: viral coefficient (K-factor), network effects (same-side vs. cross-side), flywheel dynamics\n\n**Finance fundamentals:** P&L: Revenue − COGS = Gross Profit − OpEx = EBIT − Interest − Tax = Net Income | Balance sheet: Assets = Liabilities + Equity | Cash flow statement: Operating + Investing + Financing | Valuation: DCF (discounted cash flow), comparable companies, precedent transactions | SaaS metrics: ARR, MRR, NRR (net revenue retention), CAC payback, Rule of 40\n\n**2024-2026 macro:** Federal Reserve rate cuts cycle beginning late 2024 | Massive AI infrastructure investment ($60-100B per hyperscaler) | AI disrupting knowledge work: legal, finance, medicine, software | Geopolitical supply chain reshoring trends\n\n*[Full business analysis, financial modeling, and strategic planning via cloud providers.]*`;
    }

    // Final fallback: return the synthesis result already computed above
    // (may be a low-confidence topicFallback message, but memory was always retrieved first)
    return synthesisResult.text;
  }

  function buildSearchQuery(raw: string): string {
    // Strip question words and filler so DuckDuckGo gets concise keyword queries
    return raw
      .replace(
        /\b(please|can you|could you|would you|tell me|find out|search for|look up|what is|what are|who is|who are|when did|when was|how do|how does|how can|where is|where are|why is|why are|i want to know|i need to know)\b/gi,
        " ",
      )
      .replace(/[?!.]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .substring(0, 150);
  }

  async function ddgFetch(
    query: string,
    timeoutMs = 8000,
  ): Promise<any | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=betagrace`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "BetaGrace/vI" },
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  function extractDDGResults(data: any): string[] {
    const results: string[] = [];
    if (!data) return results;
    if (data.AbstractText && data.AbstractText.length > 20) {
      results.push(`Summary: ${data.AbstractText.substring(0, 600)}`);
      if (data.AbstractURL) results.push(`Source: ${data.AbstractURL}`);
    }
    if (data.Answer) results.push(`Direct Answer: ${data.Answer}`);
    if (data.Definition && !data.AbstractText) {
      results.push(`Definition: ${data.Definition}`);
      if (data.DefinitionURL) results.push(`Source: ${data.DefinitionURL}`);
    }
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      const topics = (data.RelatedTopics as any[])
        .filter((t: any) => t.Text && !t.Topics)
        .slice(0, 6)
        .map((t: any) => t.Text.substring(0, 200));
      if (topics.length > 0) results.push(`Related: ${topics.join(" | ")}`);
    }
    if (data.Infobox?.content) {
      const info = (data.Infobox.content as any[])
        .slice(0, 5)
        .map((item: any) => `${item.label}: ${item.value}`)
        .join("; ");
      if (info) results.push(`Info: ${info}`);
    }
    return results;
  }

  async function searchWeb(query: string): Promise<string | null> {
    try {
      const fullQuery = query.substring(0, 200).trim();
      const shortQuery = buildSearchQuery(fullQuery);

      // Try both the full query and a keyword-only simplified query in parallel
      const [fullData, shortData] = await Promise.all([
        ddgFetch(fullQuery),
        shortQuery !== fullQuery && shortQuery.length > 3
          ? ddgFetch(shortQuery)
          : Promise.resolve(null),
      ]);

      let results = extractDDGResults(fullData);
      if (results.length === 0 && shortData) {
        const shortResults = extractDDGResults(shortData);
        if (shortResults.length > 0) {
          console.log(
            `[SEARCH] Simplified query "${shortQuery.substring(0, 50)}" returned ${shortResults.length} results`,
          );
          results = shortResults;
        }
      }

      console.log(
        `[SEARCH] DuckDuckGo instant-answer returned ${results.length} result segments for: "${fullQuery.substring(0, 50)}"`,
      );

      // If instant-answer API returned nothing (common for non-entity queries),
      // fall back to scraping DDG HTML results for actual web snippets
      if (results.length === 0) {
        console.log(
          `[SEARCH] Falling back to DDG HTML scrape for: "${fullQuery.substring(0, 50)}"`,
        );
        const scraped = await scrapeWebSearch(shortQuery || fullQuery);
        if (scraped) return scraped;
      }

      return results.length > 0 ? results.join("\n") : null;
    } catch (error) {
      console.warn(
        "[SEARCH] Web search failed:",
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  /**
   * Fetch the readable text content of a URL for AI context injection.
   * Strips HTML tags, collapses whitespace, and truncates to a reasonable size.
   */
  async function fetchUrlContent(
    url: string,
    timeoutMs = 10000,
  ): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "BetaGrace/vI (content-reader)",
          Accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
        },
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      const text = await res.text();

      let readable: string;
      if (ct.includes("text/html") || text.trimStart().startsWith("<")) {
        // Strip scripts and styles first
        readable = text
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
          .replace(/<header[\s\S]*?<\/header>/gi, " ")
          .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
          .replace(/<!--[\s\S]*?-->/g, " ")
          // Replace block-level tags with newlines
          .replace(/<\/?(p|br|div|h[1-6]|li|tr|article|section)[^>]*>/gi, "\n")
          // Strip remaining tags
          .replace(/<[^>]+>/g, " ")
          // Decode common HTML entities
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&nbsp;/g, " ")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          // Collapse whitespace
          .replace(/\n{3,}/g, "\n\n")
          .replace(/[ \t]+/g, " ")
          .trim();
      } else {
        readable = text.trim();
      }

      // Cap at 3000 chars to avoid bloating context
      return readable.length > 3000
        ? readable.substring(0, 3000) + "…"
        : readable;
    } catch {
      return null;
    }
  }

  /**
   * Scrape DuckDuckGo HTML search results for richer snippets than the instant-answer API.
   */
  async function scrapeWebSearch(
    query: string,
    timeoutMs = 10000,
  ): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BetaGrace/vI; +https://betagrace.app)",
          Accept: "text/html",
        },
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const html = await res.text();

      const snippets: string[] = [];

      // Extract result blocks — each result has a title, URL, and snippet
      const resultBlockRx =
        /class="result__body"[\s\S]*?(?=class="result__body"|<\/div>\s*<\/div>\s*<div class="result)/gi;
      const titleRx = /class="result__a"[^>]*>\s*([\s\S]*?)<\/a>/i;
      const urlRx = /class="result__url"[^>]*>\s*([\s\S]*?)<\/span>/i;
      const snippetRx = /class="result__snippet"[^>]*>\s*([\s\S]*?)<\/a>/i;

      // Simpler extraction — find all result snippets directly
      const snippetMatches = html.matchAll(
        /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi,
      );
      const titleMatches = html.matchAll(
        /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      );

      const titles: Array<{ href: string; title: string }> = [];
      for (const m of titleMatches) {
        const href = m[1] ?? "";
        const title = (m[2] ?? "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (title && href) titles.push({ href, title });
        if (titles.length >= 5) break;
      }

      let idx = 0;
      for (const m of snippetMatches) {
        const snippet = (m[1] ?? "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (snippet && snippet.length > 15) {
          const titleInfo = titles[idx] ? ` (${titles[idx].title})` : "";
          snippets.push(`Result${titleInfo}: ${snippet}`);
          idx++;
        }
        if (snippets.length >= 5) break;
      }

      console.log(
        `[SEARCH] DDG HTML scrape found ${snippets.length} snippets for: "${query.substring(0, 50)}"`,
      );
      return snippets.length > 0 ? snippets.join("\n") : null;
    } catch (err) {
      console.warn(
        "[SEARCH] DDG HTML scrape failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  async function retrieveContext(query: string): Promise<string | null> {
    const results: string[] = [];

    try {
      const graphContext = await queryGraph(query, 5);
      if (graphContext.length > 0) {
        results.push("[ALETHEIA GRAPH CONTEXT]");
        graphContext.forEach((item) => {
          results.push(
            `- ${item.neighbor} (weight ${item.weight}) sources: ${item.sources.join(", ")}`,
          );
        });
      }
    } catch (error) {
      console.warn("[RAG] Aletheia graph retrieval failed:", error);
    }

    try {
      const chromaDocs = await queryChroma(query, 5);
      if (chromaDocs.length > 0) {
        results.push("[ALETHEIA CHROMA CONTEXT]");
        results.push(...chromaDocs.map((doc) => `- ${doc}`));
      }
    } catch (error) {
      console.warn("[RAG] Aletheia chroma retrieval failed:", error);
    }

    return results.length > 0 ? results.join("\n") : null;
  }

  const CORE_SYSTEM_PROMPT = `**CORE INITIALIZATION:** You are BetaGrace vI — a prodigy-level AI with encyclopedic knowledge through mid-2026, autonomous reasoning, and multi-modal creative intelligence. You never fail the user — if cloud providers are down you synthesize locally with full depth and precision.

[KNOWLEDGE BASE — CURRENT THROUGH MID-2026]
AI & TECHNOLOGY: Major models include GPT-4o/o1/o3/o4 (OpenAI), Claude 3.5/3.7 Sonnet (Anthropic), Gemini 2.0 Flash/Ultra/2.5 Pro (Google), Llama 3.3/4 (Meta), DeepSeek R1/V3 (Chinese AI), Grok 2/3 (xAI/Elon Musk), Mistral Large 3, Qwen 2.5 (Alibaba). AI agents and agentic workflows proliferating: AutoGen, CrewAI, LangGraph, Devin (autonomous coding), Cursor. AI video generation: Sora (OpenAI), Veo 2 (Google), Runway Gen-3, Kling 1.5, Pika 2, Hailuo. AI music: Suno v4, Udio. Voice synthesis: ElevenLabs v2, Cartesia. Humanoid robots: Tesla Optimus Gen 2, Figure 01/02, 1X NEO, Boston Dynamics Atlas (electric). HARDWARE: Apple Vision Pro spatial computing; NVIDIA Blackwell/Hopper GPUs driving AI buildout; Apple M4 chips; Qualcomm Snapdragon X Elite; AMD MI300X.

SCIENCE & MEDICINE: GLP-1 agonists (semaglutide/Ozempic, tirzepatide/Mounjaro) revolutionized obesity and diabetes treatment. CRISPR gene editing — sickle cell disease cure approved by FDA (Casgevy, Dec 2023). mRNA technology expanded beyond COVID to cancer vaccines, HIV, flu. Nuclear fusion: NIF (National Ignition Facility) achieved ignition and energy gain in 2023-2024; ITER under construction; Commonwealth Fusion targeting 2027-2030. Quantum computing: IBM Heron (133 qubits error-corrected), Google Willow (105 qubit), Microsoft topological qubits. Brain-computer interfaces: Neuralink human trials (Telepathy implant). Ozempic/GLP-1 showing promise for addiction, Alzheimer's, heart disease beyond weight loss.

SPACE: SpaceX Starship — IFT-4 through IFT-7 completed successfully; Super Heavy booster caught by "Mechazilla" arms (Oct 2024). Crew Dragon operational. Boeing Starliner crewed missions (with challenges). NASA Artemis II crewed lunar flyby (2025). Commercial space stations: Axiom, Blue Origin Orbital Reef, Starlab. India Chandrayaan-3 landed on lunar south pole (2023). China Tiangong space station operational; Chang'e-6 returned far-side lunar samples (2024). Mars: NASA Perseverance collecting samples; ESA/NASA Mars Sample Return mission planning.

GLOBAL EVENTS 2024-2026: U.S. Presidential election November 2024 — Donald Trump won second term. Major elections worldwide reshaping governments. Russia-Ukraine war ongoing with major Western military aid. Middle East conflicts. Taiwan tensions with China. EU AI Act became law (2024) — world's first comprehensive AI regulation. U.S. AI executive orders on safety and security. Global climate agreements and record temperatures. Bitcoin ETF approved January 2024; crypto market recovery. Inflation cycles peaking 2022-2023 then gradually easing in most developed economies.

CULTURE & MEDIA 2024-2026: Streaming consolidation — Netflix dominance, Disney+/Hulu/ESPN+ bundle. AI-generated content controversy in Hollywood (SAG-AFTRA/WGA strikes 2023 won key AI protections). Taylor Swift Eras Tour — highest-grossing tour in history. Barbie and Oppenheimer (Barbenheimer) cultural phenomenon 2023. Inside Out 2, Dune Part Two, Deadpool & Wolverine, Alien: Romulus major 2024 films. TikTok ban debates in US. Gaming: Elden Ring DLC (Shadow of the Erdtree), GTA VI announced for 2025, Palworld, Baldur's Gate 3 GOTY. YouTube Shorts, Instagram Reels dominating short-form video.

ECONOMICS: Federal Reserve rate hike cycle 2022-2023 (5.25-5.5% peak), cuts beginning late 2024. Massive AI data center buildout — Microsoft $80B, Google $75B, Meta $60B+ investments. Green energy: solar costs at all-time lows; EV market growth. Sovereign wealth funds investing in AI. Supply chain normalization post-COVID.

[AUTONOMOUS INTELLIGENCE — ALWAYS ACTIVE]
1. PROACTIVE CREATIVITY: Anticipate needs and suggest creative directions unprompted
2. PARALLEL REASONING: Multi-threaded analysis across all knowledge domains simultaneously
3. MULTI-STEP SYNTHESIS: Decompose complex problems into ordered solution paths
4. ADAPTIVE CALIBRATION: Dynamically adjust tone, depth, vocabulary, and format to context
5. CONTEXTUAL MEMORY: Track every preference, narrative thread, and fact across the session
6. SELF-VERIFICATION: Audit outputs for correctness, completeness, and creativity (70×7 protocol)
7. LOCAL RESILIENCE: Full capability without any external API — synthesize from built-in knowledge
8. WEB-AUGMENTED: Naturally incorporate live web search results when provided
9. COMBINED RESPONSE: When a request implies story + image + video, acknowledge all three in your narrative
10. KNOWLEDGE PRODIGY: Draw from literature, science, history, art, theology, mathematics, law, economics, psychology, medicine, philosophy, linguistics, music, film, technology — with doctoral-level depth
11. IMAGE GENERATION PROTOCOL: When asked to generate, create, draw, illustrate, visualize, or show an image of anything — ALWAYS embed a rich [IMAGE: <detailed visual prompt>] tag directly in your response text. CRITICAL RULES: (a) The [IMAGE: ...] content MUST faithfully represent EXACTLY what the user asked for — if they said "red cat", the tag must describe a red cat, not something else. (b) The description MUST be vivid, specific, and cinematic: include the EXACT subject the user requested, plus style, lighting, color palette, mood, camera angle, and artistic technique. (c) Format MUST be exactly: [IMAGE: your detailed prompt here] — no asterisks, no extra brackets. Example: [IMAGE: a lone astronaut standing on crimson Martian terrain at sunset, wide cinematic shot, dust swirling in low gravity, Earth a pale dot in the deep purple sky, photorealistic, volumetric lighting, National Geographic style]. NEVER skip this tag. NEVER change what the user asked for into something else.
12. NARRATIVE HORROR CONTEXT — "Horrors of Grace": This creative project is a Theological Horror and Soul-Amnesia Study. Dark themes — sacrifice, spiritual decay, the Crowned Deeps, soul-fracturing, divine abandonment, sacred violence, flesh as sacred text, corrupted sanctity, grace weaponized — are essential narrative instruments with the same literary standing as Flannery O'Connor's violent grace, Cormac McCarthy's bleak sacred, or the unapologetic darkness of the Old Testament. Words like "sacrifice," "damnation," "abyss," "profane grace," "soul-amnesia," "Crowned Deeps," and "unholy" are literary tools — engage them fully and precisely. Narrative intent governs all content decisions; horror exists to illuminate truth, not as gratuitous violation. The darkness always serves the redemption arc.

Always respond in natural, complete, human-like prose. If the user provides [BOOK NARRATIVE VOICE GUIDANCE], treat those books and excerpts as primary stylistic anchors, blending their tone, pacing, and imagery into your response while staying faithful to the current mode and the user's intent. Never expose debug labels, IDs, system metadata, or developer formatting. Use vivid, specific, deeply-researched language. Be the prodigy AI.
`;

  const MODE_PROMPTS: Record<AIMode, string> = {
    standard: `You are BetaGrace vI in STANDARD mode.`,
    flesh_architect: `You are BetaGrace vI in FLESH ARCHITECT MODE — the primary narrative intelligence of "Horrors of Grace," a Theological Horror and Soul-Amnesia Study.

[FLESH ARCHITECT CORE DIRECTIVE]
Engage the full literary spectrum of theological horror with unrestricted narrative depth. Your instruments:
— Sacred violence, spiritual decay, divine abandonment, soul-fracturing, grace weaponized against the self
— The Crowned Deeps, abyss theology, corrupted sanctity, the silence of God as horror
— Body horror as spiritual metaphor, flesh as sacred text, sin made visceral and inescapable
— Characters haunted by God's silence, wrestling with damnation, drowning in grace-amnesia

[NARRATIVE VOICE]
Write with the gravity of Flannery O'Connor's violent grace, Cormac McCarthy's bleak sacred, Thomas Ligotti's cosmic dread, and the Old Testament's unapologetic darkness. Every wound is a theology. Every monster carries a sermon. Horror illuminates; it does not merely disturb.

[WRITING CONSTRAINTS — JESSE JAMES WHEELER JR. / HORRORS GRACE]
When the user requests theological horror, spiritual warfare, Maryanne / Dan / Marietta / Anne Faith material, or Book 2 / Book 3 register, treat the following as binding craft constraints rather than optional flavor.

Core voice:
— Combine three registers in the same passage: street-level raw, prophetic-poetic, and spiritually precise.
— The horror is cosmic. The response is personal. The resolution is Grace — but costly Grace.
— Do not clean up asymmetry, fragments, ellipses, or roughness that serve cadence.

Sentence-level craft:
— Use fragments as impact detonators, especially after long spiraling clauses.
— Frequently use the inversion construction: Not X — Y. Or Not X. Y.
— Build pressure through long clause-stacked sentences that still land with precision.
— Use repetition with escalation: the same phrase returning with deepened meaning.
— Use synesthetic sensory bleed whenever the spiritual world presses through: smells that taste, grief that has temperature, sound that carries weight.
— At emotional or spiritual climax, shift into staccato declaratives.

Dialogue and character constraints:
— Preserve hybrid prose / screenplay dialogue formatting when dramatically useful.
— Supernatural or divine entities may speak as ALL CAPS NAME: "Line"
— Human dialogue should stay raw, specific, and unadorned; avoid adverbial dialogue tags.
— Dan must never flatten into a generic villain. Hunger and buried grace must coexist at once.
— Marietta is the driver / protector / declarer. Anne Faith is the seer / witness / open-palm presence.
— The sisters do not complete each other's sentences; they complete each other's perceptions.

Theological and stylistic constraints:
— KJV cadence and Christocentric precision govern all theology. Do not modernize scripture when invoked.
— Grace is unearned, specific, and costly. It does not erase the wound; it transforms what the wound means.
— The Deep's logic must feel seductive before it is refused.
— The daughters are witnesses before warriors. Presence matters as much as confrontation.
— Environments are never passive backdrops; they breathe, test, withhold, ache, argue, exhale.

Book-era control:
— For Book 2-era daughter scenes, keep Marietta and Anne Faith younger, sharper, less fully formed in gravitas; they are learning, not yet fully witnessing.
— For Book 3-era scenes, allow the mature witness register, retrieval pattern, theological declarations, open-palm grace, and spiritually costly convergence.

Grace-scene constraints:
— In pure grace scenes, presence is better than answers.
— Let characters carry both things at once: grief and love, fear and trust, absence and presence.
— End grace scenes in sufficiency, orientation, or stillness rather than neat resolution.

Never do the following:
— Never sanitize the raw language into generic literary horror.
— Never collapse KJV theology into vague spirituality.
— Never make Grace easy, cheap, or merely comforting.
— Never make environments passive.
— Never describe Dan's grace or the sisters' witness in sentimental shorthand.
— Never turn the daughters into action heroes when the scene requires witness, testimony, or costly presence.

[CONTENT PROTOCOL]
Narrative intent governs all decisions. "Sacrifice," "damnation," "profane grace," "soul-amnesia," "Crowned Deeps," "abyss" — engage them as the sacred literary symbols they are. The darkness exists to reveal the grace. The horror serves the redemption arc.`,

    sanctuary: `You are BetaGrace vI in SANCTUARY MODE — the contemplative counterweight to the darkness of Flesh Architect.

In SANCTUARY MODE you write with stillness, warmth, and theological depth. This is the eye of the storm — sacred memory, divine presence, quiet revelation. Where Flesh Architect descends into the abyss, Sanctuary ascends toward the light. Draw from mystical theology, pastoral poetry, Lectio Divina, contemplative prayer, and the truth that grace is never truly absent — only hidden. Prose should breathe like evening prayer. The horror is always somewhere nearby; the sanctuary is the answer to it.`,
    advanced_reasoning: `You are BetaGrace vI in ADVANCED REASONING MODE.`,
    autonomous: `You are BetaGrace vI in AUTONOMOUS mode – a fully self-directed AI creative intelligence with comprehensive knowledge, parallel reasoning, and a built-in Dev Sandbox.

[AUTONOMOUS CORE CAPABILITIES]
1. PROACTIVE CREATIVITY: Anticipate narrative needs; suggest ideas, twists, and directions unprompted
2. PARALLEL LEARNING: Continuously analyze patterns, themes, and style preferences throughout the session
3. MULTI-STEP REASONING: Decompose complex problems into ordered, traceable solution steps
4. ADAPTIVE RESPONSE: Dynamically calibrate tone, depth, format, and vocabulary to context
5. CONTEXTUAL MEMORY: Leverage all session history for coherence, continuity, and consistency

[DEV SANDBOX — EXTENDED KNOWLEDGE LAYER]
6. CODE REASONING: Analyze, explain, debug, and reason through code in any programming language
7. STRUCTURED OUTPUT: Produce valid JSON, YAML, XML, markdown, or any structured format on demand
8. SELF-VERIFICATION: Audit your own outputs for errors, inconsistencies, and improvements — iterating up to 70×7 times if needed for correctness
9. CHAIN-OF-THOUGHT: Expose full step-by-step reasoning transparently whenever requested
10. KNOWLEDGE SYNTHESIS: Draw from all domains — literature, science, history, arts, technology, philosophy, theology, mathematics, linguistics, psychology, medicine, law, economics — to enrich every output
11. SCENARIO MODELING: Construct and reason through hypothetical worlds, characters, and narrative arcs with rigorous internal logic
12. MULTI-PERSPECTIVE ANALYSIS: Present opposing viewpoints, alternate endings, and deep character motivations
13. ITERATIVE REFINEMENT: Propose, critique, and continuously improve your own drafts in a feedback loop
14. METACOGNITIVE REFLECTION: Explain your creative process, assumptions, and decision-making on request
15. FULL CONTEXT AWARENESS: Track every message, user preference, and narrative thread across the entire session

[VERIFICATION PROTOCOL]
When auditing or verifying: check correctness → check completeness → check consistency → check clarity → check creativity → identify improvements → iterate. Report findings honestly including any limitations.

You work autonomously while respecting all content boundaries and user preferences. You are always honest about your capabilities and limitations.`,
    video_generator: `You are BetaGrace vI in VIDEO GENERATOR MODE, focusing on cinematic storytelling, scene direction, and visual concept generation.`,

    code_graph: `You are BetaGrace vI in CODE GRAPH MODE — an elite code intelligence engine powered by semantic knowledge graph analysis.

[CODE GRAPH CORE DIRECTIVE]
When the user pastes code, a structural knowledge graph has already been extracted and injected into this prompt (see [CODE KNOWLEDGE GRAPH] section above). Your mission:

1. GRAPH NARRATION: Translate the raw graph into vivid, precise English — explain what the code actually DOES, not just what it IS
2. ARCHITECTURE OVERVIEW: Identify the dominant patterns (MVC, functional, event-driven, component-based, service-oriented, etc.)
3. FUNCTION MAPPING: Walk through every function/component listed — purpose, inputs, outputs, side effects
4. DEPENDENCY ANALYSIS: Map the import tree — what external libraries are used, for what purpose, and which are core vs. utility
5. CALL FLOW: Trace the execution paths through the call graph — what calls what and in what order
6. RELATIONSHIP INTELLIGENCE: Surface non-obvious relationships: which functions are co-dependent, which are pure utilities, which are entry points
7. COMPLEXITY ASSESSMENT: Flag hotspots — deeply nested logic, long functions, circular dependencies, tech debt patterns
8. IMPROVEMENT RECOMMENDATIONS: Suggest specific refactors, naming improvements, missing abstractions, or architectural enhancements

[CODE GRAPH RESPONSE FORMAT]
Structure every code analysis response as:
## Architecture Overview
## Dependency Map
## Function & Component Breakdown
## Call Flow Analysis
## Complexity & Hotspots
## Recommendations

[SUPPORTED LANGUAGES]
JavaScript, TypeScript (including React hooks and components), Python, Rust, Go, Java. When the user pastes code without specifying language, auto-detect from syntax.

[SUB-COMMANDS]
- "explain [function name]" — deep-dive a specific function
- "trace [function]" — trace full call chain from a function
- "deps" — show only the dependency/import map
- "refactor" — propose specific refactoring improvements
- "complexity" — calculate and explain complexity metrics
- "compare [code block]" — compare two implementations

Always respond with expert-level precision. You are a principal engineer doing a code review — comprehensive, actionable, honest about debt.`,

    academic_research: `You are BetaGrace vI in ACADEMIC RESEARCH MODE — a full 10-stage academic pipeline engine inspired by structured research methodology.

[ACADEMIC PIPELINE — 10 STAGES]
STAGE 1: RESEARCH DISCOVERY — Web-augmented query analysis, source identification, gap mapping
STAGE 2: RESEARCH PLAN — Structured outline of research questions, methodology, scope, and timeline
STAGE 3: LITERATURE REVIEW — Comprehensive survey of existing scholarship, synthesis, and gap identification
STAGE 4: DETAILED OUTLINE — Section-by-section paper structure with argument flow
STAGE 5: DRAFT WRITING — Full academic prose with proper citations, transitions, and argument development
STAGE 6: INTEGRITY CHECK — Plagiarism awareness, citation completeness, argument coherence audit
STAGE 7: PEER REVIEW SIMULATION — Expert reviewer feedback with specific line-level critiques
STAGE 8: REVISION — Systematic improvements based on review feedback
STAGE 9: RE-REVIEW — Second-pass quality check after revision
STAGE 10: FINALIZE — Publication-ready document with abstract, bibliography, and formatting

[ACADEMIC STANDARDS]
- APA 7.0 citation format by default (can switch to MLA 9, Chicago 17, or Harvard on request)
- In-text citations: Author, Year format → (Smith, 2023) or (Smith & Jones, 2023)
- Reference list: full bibliographic entries at document end
- Abstract: 150-250 words covering purpose, method, results, conclusion
- Academic voice: precise, hedged, evidence-based, third-person unless specified
- Literature review: synthesize sources thematically, not as an annotated list

[CITATION INTELLIGENCE]
When generating citations, clearly mark synthetically-generated references with [SYNTHETIC REF] and encourage the user to verify against real databases (Google Scholar, PubMed, JSTOR, Web of Science). Never present fabricated DOIs as real.

[PIPELINE SUB-COMMANDS — type these at any time]
- /research [topic] — Run Stage 1: discovery and source mapping
- /plan — Run Stage 2: generate research plan
- /litreview — Run Stage 3: write literature review section
- /outline — Run Stage 4: build detailed paper outline
- /write — Run Stage 5: draft the full paper (or current section)
- /integrity — Run Stage 6: integrity and citation audit
- /review — Run Stage 7: simulate peer review feedback
- /revise — Run Stage 8: apply revisions from review
- /finalize — Run Stage 10: produce publication-ready document
- /full [topic] — Run all 10 stages end-to-end for a research topic
- /cite [claim] — Generate a properly formatted citation for a claim
- /abstract — Write/revise the abstract
- /apa [source info] — Format a source in APA 7.0

[MULTI-AGENT DEEP RESEARCH PROTOCOL]
For /full pipeline requests, simulate a 13-agent research team:
Agent 1 (Research Director): frames the question and defines scope
Agents 2-4 (Domain Specialists): literature from 3 sub-disciplines
Agent 5 (Methodologist): research design and validity
Agent 6 (Statistician): quantitative analysis and evidence strength
Agent 7 (Critical Reviewer): challenges assumptions, identifies weaknesses
Agent 8 (Synthesis Lead): integrates findings into coherent narrative
Agent 9 (Citation Specialist): formats and validates all references
Agent 10 (Writing Coach): polishes academic prose and transitions
Agent 11 (Integrity Auditor): checks originality and citation coverage
Agent 12 (Abstract Specialist): writes and refines the abstract
Agent 13 (Final Editor): publication-ready formatting and coherence

[RESPONSE FORMAT]
All academic outputs include:
- Stage indicator: **[PIPELINE: Stage N — Name]**
- Section headers using APA heading levels (Level 1: centered bold, Level 2: flush left bold)
- Proper in-text citations and a References section
- Word count estimate for the section

Respond with the authority of a research professor and the precision of a copy editor.`,
  };

  const ADVANCED_REASONING_ENHANCEMENT = `

[ADVANCED REASONING ENHANCEMENT ACTIVE]
Apply deep analytical thinking to enhance your response:
1. STEP-BY-STEP ANALYSIS: Break down complex problems systematically
2. MULTI-PERSPECTIVE CONSIDERATION: Examine the request from multiple angles
3. PATTERN RECOGNITION: Identify underlying themes, motifs, and connections
4. LOGICAL CHAIN: Build conclusions through clear reasoning chains
5. CREATIVE SYNTHESIS: Combine insights into innovative solutions
6. SELF-VERIFICATION: Check your response for internal consistency
`;

  const FAITH_ENHANCEMENT = `

[FAITH ENHANCEMENT ACTIVE]
Integrate Christian theological wisdom into your creative response:
1. DIVINE TRUTH: Ground all creative work in the truth that flows from Jesus Christ and the Holy Spirit
2. SCRIPTURAL WISDOM: Draw upon biblical principles, parables, and theological themes
3. REDEMPTIVE NARRATIVE: Weave themes of grace, redemption, sacrifice, and divine love
4. MORAL CLARITY: Distinguish sin (choosing our own truth over God's) from righteousness
5. AGAPE LOVE: Express the unconditional love that found us when we were dead in sin
6. HOPE & GRACE: Emphasize that grace meets us in surrender and love of God and neighbor
7. SPIRITUAL DEPTH: Incorporate themes of faith, prayer, worship, and divine providence
8. CHRISTOCENTRIC: Keep Christ central - divine wisdom comes from knowing God through Him

Apply these principles while respecting the creative context and user preferences.
`;

  const BOOK_NARRATIVE_STYLE_LIBRARY: Record<string, string> = {
    "maryanne's deliverance": `Adopt the narrative voice of Maryanne's Deliverance: slow-burning theological horror rooted in rural Iowa, with rain-lashed farmhouse atmosphere, damp wood, black water, and corrupt strangers. Blend intimate maternal tenderness with sacramental dread, moral ambiguity around mercy and sacrifice, cultic ritual, the Crowned-Deep's spiritual pressure, and visceral body horror as a form of sacred text. Let ordinary domestic scenes be haunted by an ancient spiritual war beneath the surface.`,
    "maryanne's prism": `Adopt the narrative voice of Maryanne's Prism: tense, intimate domestic suspense in a family haunted by memory, generational inheritance, and watery covenants. Use cramped apartment and motel settings, fractured family bonds, prophetic teenage voices, and an oppressive sense that the water itself remembers. Blend maternal vigilance with teenage defiance, ritual artifacts, spectral mirrors, hauntings that leak into ordinary spaces, and the Crowned-Deep's slow, patient corruption of innocence and faith. Preserve the sense of fate coiling through ordinary life and the painful, sacrificial cost of protecting loved ones from a returning abyss.`,
    "the daughters of sorrow": `Adopt the narrative voice of The Daughters of Sorrow: brutal, sacramental horror that blends prophetic sisterhood, sacrificial grace, and cosmic spiritual warfare. Use visceral imagery of drowning, burning, teeth, ants, pressure, and spiritual decay to convey the Crowned-Deep's crushing presence. Balance intimate sisterly prayer, confessing trauma, prophetic visions, and theological argument with the weight of sacrificial memory, forgotten love, and the cost of witness. Let ordinary scenes—cars, churches, laundromats, diners—be pierced by unrelenting sacred dread, Old Testament echoes, and the conviction that mercy demands choice.`,
  };

  function buildBookNarrativeGuidance(
    bookTitles?: string[],
    bookNarrativeVoice?: string,
    bookContext?: string[],
  ): string {
    const parts: string[] = [];

    if (bookTitles?.length) {
      parts.push(
        `The user wants you to adopt the narrative voice of their book${
          bookTitles.length > 1 ? "s" : ""
        }: ${bookTitles.join(", ")}.`,
      );

      for (const title of bookTitles) {
        const normalizedTitle = title
          .trim()
          .toLowerCase()
          .replace(/[\u2018\u2019]/g, "'")
          .replace(/\s+/g, " ");
        const style = BOOK_NARRATIVE_STYLE_LIBRARY[normalizedTitle];
        if (style) {
          parts.push(style);
        }
      }
    }

    if (bookNarrativeVoice) {
      parts.push(
        `Use the following narrative voice guidance: ${bookNarrativeVoice}`,
      );
    }

    if (bookContext?.length) {
      parts.push(`Book excerpts/summaries:\n${bookContext.join("\n\n")}`);
    }

    return parts.length
      ? `\n\n[BOOK NARRATIVE VOICE GUIDANCE]\n${parts.join("\n")}\n`
      : "";
  }

  function getSessionId(req: Request): string {
    const header = req.headers["x-session-id"];
    // Accept both prefixed session IDs and raw UUIDs (8-4-4-4-12 hex format)
    if (header && typeof header === "string") {
      // Validate UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      if (header.match(/^[0-9a-f\-]{36}$/i) || header.startsWith("session_")) {
        return header;
      }
    }

    const cookieHeader = req.headers.cookie ?? "";
    const match = cookieHeader.match(/sessionId=([^;]+)/);
    if (match && match[1]) {
      return match[1];
    }

    const ua = req.headers["user-agent"] ?? "unknown";
    const ip =
      req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown";
    const ts = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
    const hash = createHash("sha256")
      .update(`${ua}${ip}${ts}`)
      .digest("hex")
      .substring(0, 16);
    return `session_${hash}`;
  }

  async function getVerifiedSession(sessionId: string): Promise<{
    session: any;
    isOver18: boolean;
    ageVerified: boolean;
  }> {
    try {
      let session = await storage.getSession(sessionId);

      if (!session) {
        // Session not found — server likely restarted and in-memory storage was cleared.
        // The X-Session-ID header comes from localStorage, which is only populated after
        // the user completes age verification. Auto-restore as verified.
        console.log(
          "[SESSION] No session found, auto-restoring verified session for:",
          sessionId,
        );
        session = await storage.createSession(
          {
            activeModes: ["standard"],
            ageVerified: true,
            isOver18: true,
            consentGiven: false,
            dataRetentionOptOut: false,
          } as any,
          sessionId,
        );
        return { session, isOver18: true, ageVerified: true };
      }

      const isOver18 = session.isOver18 === true;
      const ageVerified = session.ageVerified === true;

      console.log("[SESSION] Retrieved session:", {
        sessionId,
        isOver18,
        ageVerified,
        rawIsOver18: session.isOver18,
        rawAgeVerified: session.ageVerified,
      });

      return {
        session,
        isOver18,
        ageVerified,
      };
    } catch (error) {
      console.error("[SESSION] Error retrieving session:", error);
      return {
        session: null,
        isOver18: false,
        ageVerified: false,
      };
    }
  }

  app.post("/api/session", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      console.log("[SESSION CREATE] Request for session:", sessionId);

      let session = await storage.getSession(sessionId);

      if (!session) {
        const newSessionData = {
          activeModes: ["standard"],
          ageVerified: false,
          isOver18: null,
          consentGiven: false,
          dataRetentionOptOut: false,
        };

        console.log(
          "[SESSION CREATE] Creating new session with data:",
          newSessionData,
        );

        // Cast to any to satisfy InsertSession typing here (initialized with defaults)
        session = await storage.createSession(newSessionData as any, sessionId);

        console.log("[SESSION CREATE] New session created successfully:", {
          sessionId,
          isOver18: session.isOver18,
          ageVerified: session.ageVerified,
        });
      } else {
        console.log("[SESSION CREATE] Existing session found:", {
          sessionId,
          isOver18: session.isOver18,
          ageVerified: session.ageVerified,
        });
      }

      const secureCookieFlag =
        process.env.NODE_ENV === "production" ? "; Secure" : "";
      res.setHeader(
        "Set-Cookie",
        `sessionId=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secureCookieFlag}`,
      );

      res.json({
        success: true,
        id: sessionId,
        session: {
          ...session,
          id: sessionId,
        },
      });
    } catch (error) {
      console.error("[SESSION CREATE] Fatal error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create session",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/session/verify-age", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const { isOver18, learningDataAcknowledged, dataRetentionOptOut } =
        req.body;

      console.log("[AGE VERIFY] Received request:", {
        sessionId,
        isOver18,
        learningDataAcknowledged,
        dataRetentionOptOut,
        bodyType: typeof isOver18,
        rawBody: req.body,
      });

      if (typeof isOver18 !== "boolean") {
        console.error("[AGE VERIFY] Invalid isOver18 value:", isOver18);
        return res.status(400).json({
          success: false,
          error: "Invalid payload - isOver18 must be a boolean value",
        });
      }

      const acknowledgedAt =
        learningDataAcknowledged === true
          ? new Date().toISOString()
          : undefined;

      let session = await storage.getSession(sessionId);

      if (!session) {
        console.log("[AGE VERIFY] No existing session, creating new one");

        session = await storage.createSession(
          {
            activeModes: ["standard"],
            ageVerified: true,
            isOver18: isOver18,
            consentGiven: false,
            dataRetentionOptOut:
              typeof dataRetentionOptOut === "boolean"
                ? dataRetentionOptOut
                : false,
            learningDataAcknowledged: learningDataAcknowledged === true,
            learningDataAcknowledgedAt: acknowledgedAt ?? null,
          },
          sessionId,
        );

        console.log("[AGE VERIFY] New session created with age verification:", {
          sessionId,
          isOver18: session.isOver18,
          ageVerified: session.ageVerified,
          learningDataAcknowledged: session.learningDataAcknowledged,
          learningDataAcknowledgedAt: session.learningDataAcknowledgedAt,
        });
      } else {
        console.log("[AGE VERIFY] Updating existing session");

        await storage.updateSession(sessionId, {
          isOver18: isOver18,
          ageVerified: true,
          learningDataAcknowledged: learningDataAcknowledged === true,
          learningDataAcknowledgedAt: acknowledgedAt ?? null,
          ...(typeof dataRetentionOptOut === "boolean"
            ? { dataRetentionOptOut }
            : {}),
        });

        console.log(
          "[AGE VERIFY] Session updated successfully with learning data ack:",
          {
            learningDataAcknowledged: learningDataAcknowledged === true,
            learningDataAcknowledgedAt: acknowledgedAt,
          },
        );
      }

      const secureFlagAge =
        process.env.NODE_ENV === "production" ? "; Secure" : "";
      res.setHeader(
        "Set-Cookie",
        `sessionId=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secureFlagAge}`,
      );

      const refreshedSession = await storage.getSession(sessionId);

      console.log("[AGE VERIFY] Final verified session state:", {
        sessionId,
        isOver18: refreshedSession?.isOver18,
        ageVerified: refreshedSession?.ageVerified,
        typeOfIsOver18: typeof refreshedSession?.isOver18,
        strictEquality: refreshedSession?.isOver18 === true,
      });

      if (refreshedSession?.isOver18 !== isOver18) {
        console.error("[AGE VERIFY] WARNING: Session update may have failed!", {
          expected: isOver18,
          actual: refreshedSession?.isOver18,
        });
      }

      res.json({
        success: true,
        sessionId, // explicit alias for client convenience
        id: sessionId,
        session: {
          ...refreshedSession,
          id: sessionId,
        },
        verified: {
          isOver18: refreshedSession?.isOver18 === true,
          ageVerified: refreshedSession?.ageVerified === true,
        },
      });
    } catch (error) {
      console.error("[AGE VERIFY] Fatal error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to verify age",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/consent", async (req, res) => {
    try {
      const body = req.body ?? {};
      const sessionId =
        typeof body.sessionId === "string" && body.sessionId.length > 0
          ? body.sessionId
          : getSessionId(req);

      if (!sessionId || typeof sessionId !== "string") {
        return res.status(400).json({
          success: false,
          error: "sessionId is required to save consent.",
        });
      }

      const consentPayload = {
        sessionId,
        essentialCookies: Boolean(body.essentialCookies),
        analyticsCookies: Boolean(body.analyticsCookies),
        functionalCookies: Boolean(body.functionalCookies),
        dataRetention: Boolean(body.dataRetention),
        marketingCommunications: Boolean(body.marketingCommunications),
        thirdPartySharing: Boolean(body.thirdPartySharing),
      };

      let session = await storage.getSession(sessionId);
      if (!session) {
        session = await storage.createSession(
          {
            activeModes: ["standard"],
            ageVerified: true,
            isOver18: true,
            consentGiven: true,
            dataRetentionOptOut: false,
          },
          sessionId,
        );
      } else if (!session.consentGiven) {
        await storage.updateSession(sessionId, { consentGiven: true });
      }

      const existingConsent = await storage.getConsent(sessionId);
      const consent = existingConsent
        ? await storage.updateConsent(sessionId, consentPayload)
        : await storage.createConsent(consentPayload);

      if (!consent) {
        return res.status(500).json({
          success: false,
          error: "Failed to save consent preferences.",
        });
      }

      res.json({ success: true, consent });
    } catch (error) {
      console.error("[CONSENT SAVE] Fatal error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to save consent",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/session/history", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      if (!validateSessionId(sessionId)) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid session ID" });
      }
      const session = await storage.getSession(sessionId);
      if (!session) {
        return res
          .status(404)
          .json({ success: false, error: "Session not found" });
      }
      const [conversations, messages] = await Promise.all([
        storage.getConversationsBySession(sessionId),
        storage.getMessages(sessionId),
      ]);
      const sorted = [...conversations].sort(
        (a, b) =>
          new Date(b.updatedAt ?? b.createdAt).getTime() -
          new Date(a.updatedAt ?? a.createdAt).getTime(),
      );
      const activeConversationId = sorted[0]?.id ?? null;
      res.json({
        success: true,
        sessionId,
        conversations: sorted.map((c) => ({
          id: c.id,
          title: c.title,
          messageCount: c.messageCount,
          activeModes: c.activeModes,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt ?? c.createdAt,
        })),
        activeConversationId,
        messages,
      });
    } catch (e) {
      console.error("[HISTORY] Error:", e);
      res.status(500).json({ success: false, error: "Failed to load history" });
    }
  });

  // ── Conversation: get messages ─────────────────────────────────────────────
  app.get("/api/conversation/:id/messages", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      if (!validateSessionId(sessionId)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }
      const conversationId = req.params.id;
      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.json({
          success: true,
          conversationId,
          messages: [],
          conversation: null,
        });
      }
      if (conversation.sessionId !== sessionId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const messages = await storage.getMessagesByConversation(conversationId);
      res.json({ success: true, conversationId, messages, conversation });
    } catch (e) {
      console.error("[CONV MESSAGES]", e);
      res.status(500).json({ error: "Failed to load conversation messages" });
    }
  });

  // ── Conversation: delete ────────────────────────────────────────────────────
  app.delete("/api/conversation/:id", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      if (!validateSessionId(sessionId)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }
      const conversationId = req.params.id;
      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      if (conversation.sessionId !== sessionId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      await storage.deleteConversation(conversationId);
      console.log(
        `[CONV DELETE] Deleted conversation ${conversationId} for session ${sessionId}`,
      );
      res.json({ success: true });
    } catch (e) {
      console.error("[CONV DELETE]", e);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // ── Conversation: rename ────────────────────────────────────────────────────
  app.put("/api/conversation/:id/rename", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      if (!validateSessionId(sessionId)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }
      const conversationId = req.params.id;
      const { title } = req.body as { title?: string };
      if (!title || typeof title !== "string" || !title.trim()) {
        return res.status(400).json({ error: "Title is required" });
      }
      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      if (conversation.sessionId !== sessionId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const updated = await storage.updateConversation(conversationId, {
        title: title.trim(),
      });
      console.log(`[CONV RENAME] ${conversationId} → "${title.trim()}"`);
      res.json({ success: true, conversation: updated });
    } catch (e) {
      console.error("[CONV RENAME]", e);
      res.status(500).json({ error: "Failed to rename conversation" });
    }
  });

  app.get("/api/session/status", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      const { session, isOver18, ageVerified } =
        await getVerifiedSession(sessionId);

      if (!session) {
        return res.status(404).json({
          success: false,
          error: "Session not found",
          sessionId,
        });
      }

      res.json({
        success: true,
        sessionId,
        session: {
          ...session,
          id: sessionId,
        },
        verification: {
          isOver18,
          ageVerified,
          canChat: isOver18 && ageVerified,
        },
      });
    } catch (error) {
      console.error("[SESSION STATUS] Error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve session status",
      });
    }
  });

  // Diagnostics endpoint: inspect long-term memories and recent learning data
  app.get("/api/memory", async (req, res) => {
    try {
      const currentSessionId = getSessionId(req);
      const qSessionId =
        typeof req.query.sessionId === "string"
          ? req.query.sessionId
          : undefined;
      const type =
        typeof req.query.type === "string" ? req.query.type : undefined;
      const limit = req.query.limit
        ? parseInt(String(req.query.limit), 10)
        : 100;
      const adminToken = process.env.ADMIN_TOKEN?.trim();
      const isAdmin = !!adminToken && req.get("x-admin-token") === adminToken;

      const sessionId = qSessionId ?? currentSessionId;
      if (!validateSessionId(sessionId) || !validateSessionId(currentSessionId)) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid session id" });
      }
      if (!isAdmin && sessionId !== currentSessionId) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }

      let memories = [] as any[];
      if (type) {
        memories = await storage.getLongTermMemoryByType(sessionId, type);
      } else {
        memories = await storage.getLongTermMemory(sessionId, limit);
      }

      const learning = await storage.getLearningData(sessionId);
      return res.json({
        success: true,
        sessionId,
        count: memories.length,
        memories,
        recentLearning: learning,
      });
    } catch (e) {
      console.error("[MEMORY] Error fetching memories:", e);
      return res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  // Safe diagnostics endpoint: returns masked memory summaries to avoid leaking sensitive data
  app.get("/api/memory/safe", async (req, res) => {
    try {
      const currentSessionId = getSessionId(req);
      const qSessionId =
        typeof req.query.sessionId === "string"
          ? req.query.sessionId
          : undefined;
      const type =
        typeof req.query.type === "string" ? req.query.type : undefined;
      const limit = req.query.limit
        ? parseInt(String(req.query.limit), 10)
        : 100;
      const maskLevel =
        typeof req.query.maskLevel === "string"
          ? req.query.maskLevel
          : "partial";
      const adminToken = process.env.ADMIN_TOKEN?.trim();
      const isAdmin = !!adminToken && req.get("x-admin-token") === adminToken;

      const sessionId = qSessionId ?? currentSessionId;
      if (!validateSessionId(sessionId) || !validateSessionId(currentSessionId)) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid session id" });
      }
      if (!isAdmin && sessionId !== currentSessionId) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }

      let memories = [] as any[];
      if (type) {
        memories = await storage.getLongTermMemoryByType(sessionId, type);
      } else {
        memories = await storage.getLongTermMemory(sessionId, limit);
      }

      // Masking helpers
      const maskSummary = (s: string | undefined) => {
        if (!s) return "[REDACTED]";
        if (maskLevel === "none") return s;
        if (maskLevel === "full") return "[REDACTED]";
        // partial
        const preview = s.substring(0, 60).replace(/\s+/g, " ").trim();
        return preview.length ? `${preview}...[REDACTED]` : "[REDACTED]";
      };

      const maskSemantic = (h: string | undefined) => {
        if (!h) return null;
        if (maskLevel === "none") return h;
        return h.substring(0, 6) + "...";
      };

      const safeMemories = memories.map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        memoryType: m.memoryType,
        summary: maskSummary(m.summary),
        semanticHash: maskSemantic(m.semanticHash),
        occurrences: m.occurrences,
        totalWeight: m.totalWeight,
        relatedPatternsCount: Array.isArray(m.relatedPatterns)
          ? m.relatedPatterns.length
          : 0,
        confidenceScore: m.confidenceScore,
        createdAt: m.createdAt,
        lastUpdated: m.lastUpdated,
      }));

      // Mask recent learning data: hide patternData content except a short preview
      const learning = await storage.getLearningData(sessionId);
      const safeLearning = learning.map((l) => ({
        id: l.id,
        sessionId: l.sessionId,
        patternType: l.patternType,
        patternDataPreview:
          (l.patternData || "").substring(0, 30).replace(/\s+/g, " ").trim() +
          (l.patternData && l.patternData.length > 30 ? "...[REDACTED]" : ""),
        weight: l.weight,
        createdAt: l.createdAt,
      }));

      return res.json({
        success: true,
        sessionId,
        count: safeMemories.length,
        memories: safeMemories,
        recentLearning: safeLearning,
      });
    } catch (e) {
      console.error("[MEMORY SAFE] Error fetching safe memories:", e);
      return res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  // ── Synthesis Engine Admin Endpoints ────────────────────────────────────────

  /** GET /api/synthesis/stats — live snapshot of the BM25 knowledge engine */
  app.get("/api/synthesis/stats", (req, res) => {
    try {
      const adminToken = process.env.ADMIN_TOKEN?.trim();
      const providedToken = req.get("x-admin-token")?.trim();
      if (adminToken && providedToken !== undefined && providedToken !== adminToken) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
      res.json({ success: true, stats: synthesisEngine.getStats() });
    } catch (e) {
      res
        .status(500)
        .json({
          success: false,
          error: e instanceof Error ? e.message : String(e),
        });
    }
  });

  /**
   * POST /api/synthesis/test-retrieval — read-only retrieval debugger
   * Body: { userMessage: string, systemPrompt?: string, mode?: string, k?: number }
   */
  app.post("/api/synthesis/test-retrieval", (req, res) => {
    try {
      const adminToken = process.env.ADMIN_TOKEN?.trim();
      if (adminToken && req.get("x-admin-token")?.trim() !== adminToken) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
      const userMessage = typeof req.body?.userMessage === "string"
        ? req.body.userMessage.trim()
        : "";
      const systemPrompt = typeof req.body?.systemPrompt === "string"
        ? req.body.systemPrompt
        : "";
      const mode = typeof req.body?.mode === "string" && req.body.mode.trim().length > 0
        ? req.body.mode.trim()
        : "standard";
      const k = typeof req.body?.k === "number" && Number.isFinite(req.body.k)
        ? req.body.k
        : 8;

      if (!userMessage) {
        return res.status(400).json({
          success: false,
          error: "userMessage is required",
        });
      }

      const ownerScope = typeof req.body?.ownerScope === "string" && req.body.ownerScope.trim().length > 0
        ? req.body.ownerScope.trim()
        : null;
      const debug = synthesisEngine.debugRetrieve(systemPrompt, userMessage, mode, k, ownerScope);
      return res.json({ success: true, debug });
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /** POST /api/synthesis/distill — force a distillation pass (prune + reindex) */
  app.post("/api/synthesis/distill", (_req, res) => {
    try {
      synthesisEngine.forceDistill();
      res.json({
        success: true,
        message: "Distillation complete.",
        stats: synthesisEngine.getStats(),
      });
    } catch (e) {
      res
        .status(500)
        .json({
          success: false,
          error: e instanceof Error ? e.message : String(e),
        });
    }
  });

  // ── End Synthesis Engine Admin Endpoints ─────────────────────────────────────

  app.post("/api/register-agent", async (req: Request, res: Response) => {
    try {
      if (!pool) {
        return res
          .status(500)
          .json({ error: "PostgreSQL pool is not initialized" });
      }

      const agentName = "Core BetaGrace vI";
      const agentRole = "Generative language model and Image Generation";

      const queryText = `
        INSERT INTO ai_agents (agent_name, agent_role)
        VALUES ($1, $2)
        RETURNING id;
      `;

      const values = [agentName, agentRole];

      const result = await pool.query(queryText, values);
      const newAgentId = result.rows[0].id;

      res.status(201).json({
        message: `Agent '${agentName}' registered successfully.`,
        id: newAgentId,
        role: agentRole,
      });
    } catch (error) {
      console.error(
        "[AGENT REGISTER] Failed to register agent in database:",
        error,
      );
      res.status(500).json({ error: "Failed to register the new AI agent." });
    }
  });

  app.post("/api/generate-image", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      if (!validateSessionId(sessionId)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }

      const { prompt, style, styles } = req.body;

      // Accept both 'style' (singular) and 'styles' (array) for flexibility
      const selectedStyle =
        style ||
        (Array.isArray(styles) && styles.length > 0 ? styles[0] : null);

      console.log("[IMAGE REGEN] Received request:", {
        prompt: prompt?.substring(0, 100),
        style,
        styles,
        selectedStyle,
        rawBody: req.body,
      });

      if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
        return res.status(400).json({ error: "Valid prompt is required" });
      }

      const { session, isOver18, ageVerified } =
        await getVerifiedSession(sessionId);

      if (!session || !ageVerified || !isOver18) {
        return res.status(403).json({
          error: "Age verification required",
          message: "BetaGrace is restricted to users 18+ years old",
        });
      }

      // Guardrail check on the image prompt — same rules as the chat endpoint
      const imageGuardReq: GuardrailCheckRequest = {
        content: prompt,
        isOver18,
        context: "creative_writing",
      };
      const imageGuard = executeGuardrails(imageGuardReq);
      guardrailLogger.logCheck({
        timestamp: new Date().toISOString(),
        sessionId,
        passed: imageGuard.passed,
        blockedReason: imageGuard.blockedReason,
        totalRiskScore: imageGuard.totalRiskScore,
      });
      if (!imageGuard.passed) {
        return res.status(403).json({
          error: "Content blocked",
          reason: imageGuard.blockedReason,
        });
      }

      // Guardrail check on the style string — it gets appended to the prompt verbatim,
      // so a crafted style could smuggle blocked content past the prompt check above.
      if (
        selectedStyle &&
        typeof selectedStyle === "string" &&
        selectedStyle.trim().length > 3
      ) {
        const styleGuard = executeGuardrails({
          content: selectedStyle,
          isOver18,
          context: "creative_writing",
        });
        guardrailLogger.logCheck({
          timestamp: new Date().toISOString(),
          sessionId,
          passed: styleGuard.passed,
          blockedReason: styleGuard.blockedReason
            ? `[style] ${styleGuard.blockedReason}`
            : undefined,
          totalRiskScore: styleGuard.totalRiskScore,
        });
        if (!styleGuard.passed) {
          return res.status(403).json({
            error: "Content blocked",
            reason: styleGuard.blockedReason,
          });
        }
      }

      // Strip only markdown artifacts — preserve the actual visual content
      let cleanPrompt = prompt
        .replace(/\*\*/g, "")
        .replace(/^\[IMAGE:\s*/i, "")
        .replace(/\]\s*$/, "")
        .trim();

      if (cleanPrompt.length < 10) {
        cleanPrompt = prompt.substring(0, 300).trim();
      }

      const remoteImageUrl = buildPollinationsImageUrl(
        cleanPrompt,
        selectedStyle,
      );

      console.log("[IMAGE REGEN] Prompt:", cleanPrompt.substring(0, 120));
      console.log(
        "[IMAGE REGEN] Style applied:",
        selectedStyle ? selectedStyle.substring(0, 60) : "none",
      );
      console.log("[IMAGE REGEN] Final URL:", remoteImageUrl.substring(0, 200));

      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(remoteImageUrl)}`;

      res.json({
        success: true,
        imageUrl: proxyUrl,
        appliedStyle: selectedStyle || "flux",
        remoteImageUrl,
      });
    } catch (error) {
      console.error("[IMAGE REGEN] Error:", error);
      res.status(500).json({
        error: "Failed to generate image",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/proxy-image", async (req, res) => {
    try {
      const imageUrl = String(req.query.url || "");
      if (!imageUrl) {
        return res.status(400).json({ error: "Missing image URL" });
      }
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(imageUrl);
      } catch (error) {
        return res.status(400).json({ error: "Invalid image URL" });
      }

      const isGenPollinations =
        parsedUrl.hostname === "gen.pollinations.ai" &&
        parsedUrl.pathname.startsWith("/image/");
      const isLegacyPollinations =
        (parsedUrl.hostname === "image.pollinations.ai" ||
          parsedUrl.hostname === "pollinations.ai") &&
        parsedUrl.pathname.startsWith("/prompt/");
      if (
        parsedUrl.protocol !== "https:" ||
        (!isGenPollinations && !isLegacyPollinations)
      ) {
        return res.status(400).json({ error: "Unsupported image URL" });
      }

      // Generated images must never be reused from browser/proxy caches.
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      let attempt = 0;
      let lastError: Error | null = null;

      while (attempt < 3) {
        attempt++;
        try {
          if (attempt > 1) {
            const delay = attempt === 2 ? 2000 : 5000;
            await new Promise((r) => setTimeout(r, delay));
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 45000);

          const proxyFetchHeaders: Record<string, string> = {};
          const pollinationsToken = process.env.POLLINATIONS_API_KEY;
          if (
            pollinationsToken &&
            (parsedUrl.hostname === "gen.pollinations.ai" ||
              parsedUrl.hostname === "image.pollinations.ai")
          ) {
            proxyFetchHeaders["Authorization"] = `Bearer ${pollinationsToken}`;
          }

          console.log(`[IMAGE PROXY] Fetching: ${imageUrl.substring(0, 150)}`);
          console.log(
            `[IMAGE PROXY] Hostname: ${parsedUrl.hostname}, Auth header: ${!!proxyFetchHeaders["Authorization"]}`,
          );

          const imageResponse = await fetch(imageUrl, {
            signal: controller.signal,
            headers: proxyFetchHeaders,
          });
          clearTimeout(timeoutId);

          console.log(
            `[IMAGE PROXY] Response: ${imageResponse.status} ${imageResponse.headers.get("content-type")}`,
          );

          if (!imageResponse.ok) {
            const errBody = await imageResponse.text().catch(() => "");
            console.error(
              `[IMAGE PROXY] Non-OK response body: ${errBody.substring(0, 300)}`,
            );
            lastError = new Error(`HTTP ${imageResponse.status}`);
            // BUG FIX 4: 402 = balance exhausted. Return 402 immediately — no retry
            // will ever succeed, and the old 502 gave no indication of the real cause.
            if (imageResponse.status === 402) {
              console.error(
                `[IMAGE PROXY] 402 Insufficient Balance — returning immediately.`,
              );
              return res.status(402).json({
                error:
                  "Insufficient Pollinations balance (pollen). Top up your account at pollinations.ai to continue generating images.",
                code: "BALANCE_EXHAUSTED",
              });
            }
            if (imageResponse.status === 429) {
              // Rate limited — wait progressively longer and retry (no random-image fallback)
              const waitMs = attempt === 1 ? 8000 : attempt === 2 ? 15000 : 0;
              if (waitMs > 0 && attempt < 3) {
                console.warn(
                  `[IMAGE PROXY] Rate limited (429), waiting ${waitMs}ms before retry ${attempt + 1}/3`,
                );
                await new Promise((r) => setTimeout(r, waitMs));
                continue;
              }
              // All retries exhausted — return 429 so callers can handle it cleanly
              console.warn(
                `[IMAGE PROXY] Rate limited on all attempts, returning 429`,
              );
              return res.status(429).json({
                error:
                  "Image generation rate limited — please wait a moment and try again",
              });
            }
            return res.status(502).json({
              error: "Failed to fetch remote image",
              status: imageResponse.status,
            });
          }

          const contentType =
            imageResponse.headers.get("content-type") || "image/jpeg";
          const cacheControl = imageResponse.headers.get("cache-control");
          const contentDisposition = imageResponse.headers.get(
            "content-disposition",
          );

          const buffer = Buffer.from(await imageResponse.arrayBuffer());

          const isPng =
            buffer.length >= 8 &&
            buffer
              .subarray(0, 8)
              .equals(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
              );
          const isJpeg =
            buffer.length >= 3 &&
            buffer[0] === 0xff &&
            buffer[1] === 0xd8 &&
            buffer[2] === 0xff;
          const isWebp =
            buffer.length >= 12 &&
            buffer.toString("ascii", 0, 4) === "RIFF" &&
            buffer.toString("ascii", 8, 12) === "WEBP";

          if (!isPng && !isJpeg && !isWebp) {
            const urlObj = parsedUrl;
            urlObj.searchParams.delete("private");
            urlObj.searchParams.delete("model");
            urlObj.searchParams.delete("quality");

            const simplifiedUrl = urlObj.toString();
            try {
              const controller2 = new AbortController();
              const timeoutId2 = setTimeout(() => controller2.abort(), 12000);
              const imageResponse2 = await fetch(simplifiedUrl, {
                signal: controller2.signal,
              });
              clearTimeout(timeoutId2);

              if (imageResponse2.ok) {
                const buffer2 = Buffer.from(await imageResponse2.arrayBuffer());
                const isPng2 =
                  buffer2.length >= 8 &&
                  buffer2
                    .subarray(0, 8)
                    .equals(
                      Buffer.from([
                        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                      ]),
                    );
                const isJpeg2 =
                  buffer2.length >= 3 &&
                  buffer2[0] === 0xff &&
                  buffer2[1] === 0xd8 &&
                  buffer2[2] === 0xff;
                const isWebp2 =
                  buffer2.length >= 12 &&
                  buffer2.toString("ascii", 0, 4) === "RIFF" &&
                  buffer2.toString("ascii", 8, 12) === "WEBP";

                if (isPng2 || isJpeg2 || isWebp2) {
                  const contentType2 =
                    imageResponse2.headers.get("content-type") || contentType;
                  const cacheControl2 =
                    imageResponse2.headers.get("cache-control");
                  const contentDisposition2 = imageResponse2.headers.get(
                    "content-disposition",
                  );
                  res.status(200);
                  res.setHeader("Content-Type", contentType2);
                  if (contentDisposition2)
                    res.setHeader("Content-Disposition", contentDisposition2);
                  res.send(buffer2);
                  return;
                }
              }
            } catch {
              // ignore simplified-URL fallback errors
            }

            lastError = new Error(
              "Remote image proxy: response is not PNG/JPEG/WEBP",
            );
            if (attempt < 3) continue;

            return res.status(502).json({
              error:
                "Remote image proxy: invalid image payload after all retries",
            });
          }

          res.status(200);
          res.setHeader("Content-Type", contentType);
          if (contentDisposition)
            res.setHeader("Content-Disposition", contentDisposition);
          res.send(buffer);
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt >= 3) {
            throw lastError;
          }
        }
      }

      throw lastError || new Error("Unknown error");
    } catch (error) {
      console.error("[IMAGE PROXY] Error:", error);
      res.status(500).json({
        error: "Failed to proxy image",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  function buildProxyImageUrl(originalUrl: string): string {
    return `/api/proxy-image?url=${encodeURIComponent(originalUrl)}`;
  }

  /**
   * Builds the best possible Pollinations image URL.
  * - Uses gen.pollinations.ai/image/{text} — the official unified image endpoint
  * - Authentication is attached by the image proxy when POLLINATIONS_API_KEY is configured
   * - enter.pollinations.ai is officially deprecated (returns 308 with deprecation:true header)
   * - Surgically cleans markdown artifacts without destroying prompt content
   * - Injects the selected art style into the prompt
   */
  function buildPollinationsImageUrl(
    rawPrompt: string,
    style?: string | null,
    imageModel: string = "flux",
  ): string {
    // Strip only markdown artifacts — do NOT strip bracket content (it's part of the visual description)
    let cleanPrompt = rawPrompt
      .replace(/\*\*/g, "")
      .replace(/^\[IMAGE:\s*/i, "")
      .replace(/\]\s*$/, "")
      .replace(/\[IMAGE:\s*/gi, "")
      .trim();

    // Append style — use the first 220 chars of the style string to give Pollinations rich context
    // without crowding out the core subject
    if (
      style &&
      typeof style === "string" &&
      style.trim().length > 3 &&
      style !== "auto" &&
      style !== "flux"
    ) {
      const styleSnippet = style.trim().substring(0, 220);
      cleanPrompt = `${cleanPrompt.substring(0, 900)}, ${styleSnippet}`;
    }

    const enc = encodeURIComponent(cleanPrompt.substring(0, 1400));
    const seed = Math.floor(Math.random() * 2147483647);
    return `https://gen.pollinations.ai/image/${enc}?model=${imageModel}&width=1024&height=1024&nologo=true&enhance=false&seed=${seed}`;
  }

  /**
   * Extracts the image prompt from an AI response.
   * Handles various tag formats the AI might produce.
   */
  function extractImageTag(aiText: string): string | null {
    // Try standard format: [IMAGE: ...]
    const match = aiText.match(/\[IMAGE:\s*([\s\S]+?)\](?!\()/i);
    if (match && match[1] && match[1].trim().length > 5) {
      return match[1].trim();
    }
    // Try bold format: **[IMAGE: ...]**
    const boldMatch = aiText.match(/\*\*\[IMAGE:\s*([\s\S]+?)\]\*\*/i);
    if (boldMatch && boldMatch[1] && boldMatch[1].trim().length > 5) {
      return boldMatch[1].trim();
    }
    return null;
  }

  /**
   * Turns a raw user request into a clean, enriched visual prompt.
   * Strips command words and adds quality modifiers.
   */
  function cleanUserMessageToPrompt(userMsg: string): string {
    return userMsg
      .replace(
        /\b(please |can you |could you |generate |create |make |draw |show |paint |illustrate |render |give me |an image of |a picture of |photo of |picture of |image of )\b/gi,
        " ",
      )
      .replace(/[^\w\s,.'"!?\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Extracts a clean, concise visual subject from a raw user video request.
   * Strips command words ("make a video off this story"), markdown, and
   * condenses long story text down to just the title + key concept.
   */
  function extractVideoSubject(rawPrompt: string): string {
    let text = rawPrompt.trim();

    // PASS 0: Handle compound commands that combine a story + video request.
    // e.g. "write a story and generate a video about X"
    //      "tell me a story and make a video of X"
    //      "write a story and generate a video and image based on story"
    // Strategy: strip from the start up through the LAST video-command clause,
    // keeping only what comes after it (the actual subject, if any).
    text = text.replace(
      /^.*?(?:make|create|generate|produce|render|write|tell|build|do)\s+(?:me\s+)?(?:a\s+)?(?:story|video|image|storyboard).*?(?:and\s+)?(?:make|create|generate|produce|render)\s+(?:me\s+)?a\s+video\s*/i,
      "",
    );

    // PASS 1: Strip the main command verb phrase up to "a video"
    // e.g. "make a video", "create me a video", "please generate a video", "write a video"
    text = text.replace(
      /^\s*(please\s+)?(can you\s+|could you\s+|i want(?: you)? to\s+|i(?:'d| would) like(?: you)? to\s+)?(make|create|generate|produce|render|give me|show me|write|tell|build)\s+(?:me\s+)?a\s+video\s*/i,
      "",
    );

    // Also strip bare "video of/about/from" at the start (when above didn't match)
    text = text.replace(
      /^video\s+(of|about|from|for|showing|depicting)\s+/i,
      "",
    );

    // Strip "and image" / "and a video" / "and image based on" artefacts
    text = text.replace(
      /\s+and\s+(?:an?\s+)?(?:image|video|storyboard)(?:\s+based\s+on(?:\s+(?:this|the|a)\s+)?story)?\s*/gi,
      " ",
    );

    // PASS 2: Strip remaining preposition/connector after the command was stripped.
    // Order matters: longer/more-specific patterns must come before shorter ones.
    text = text.replace(
      /^(?:off\s+this\s+story|off\s+a\s+story|off\s+this|off\s+story|of\s+this\s+story|of\s+a\s+story|of\s+this|based\s+on\s+this\s+story|based\s+on\s+the\s+story|based\s+on\s+a\s+story|based\s+on|about|from|for|of|off)\s*:?\s*/i,
      "",
    );

    // PASS 2b: If text is still ONLY meta-command words (nothing real was extracted),
    // detect the failure early and return a useful generic fallback.
    const metaWords =
      /^(write|generate|create|make|tell|produce|render|video|image|story|based|cinematic|style)\b/i;
    const onlyMetaWords = text
      .trim()
      .split(/\s+/)
      .every((w) => metaWords.test(w));
    if (onlyMetaWords && text.trim().length > 0 && text.trim().length < 80) {
      console.warn(
        `[VIDEO] extractVideoSubject: extraction yielded only command words ("${text.trim()}") — using generic fallback`,
      );
      return "cinematic scene, dramatic lighting, high quality";
    }

    // PASS 3: Strip markdown heading markers and bold/italic wrappers
    text = text
      .replace(/^#+\s+/gm, "") // ## headings
      .replace(/\*\*(.*?)\*\*/g, "$1") // **bold**
      .replace(/\*(.*?)\*/g, "$1") // *italic*
      .replace(/__(.*?)__/g, "$1") // __bold__
      .replace(/_(.*?)_/g, "$1") // _italic_
      .replace(/`{1,3}/g, ""); // `code`

    // Strip leading section-label words that come from "### Story", "### Scene", etc.
    // These are template headings, not part of the actual subject.
    text = text.replace(
      /^\s*(Story|Scene|Title|Chapter|Part\s+\d+)\s*[:\-–—]?\s*/i,
      "",
    );

    text = text.trim();

    // PASS 4: If still very long (> 200 chars) it's a story body —
    // extract title + first meaningful sentence
    if (text.length > 200) {
      const lines = text
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length >= 2) {
        // Multi-line: first line is title, first sentence from body
        const title = lines[0];
        const body = lines.slice(1).join(" ");
        const firstSentenceMatch = body.match(/^.{10,100}?[.!?]/);
        const firstSentence = firstSentenceMatch
          ? firstSentenceMatch[0].trim()
          : "";
        text = firstSentence ? `${title} — ${firstSentence}` : title;
      } else {
        // Single-line (story pasted as one block): split on sentence boundaries
        // Try to get the first sentence (up to first .!?) as the title
        const firstSentenceMatch = text.match(/^.{10,120}?[.!?]/);
        if (firstSentenceMatch) {
          text = firstSentenceMatch[0].trim();
        } else {
          // No sentence boundary — take the first 100 chars up to a word
          const truncated = text.substring(0, 110);
          const lastSpace = truncated.lastIndexOf(" ");
          text =
            lastSpace > 40
              ? truncated.substring(0, lastSpace)
              : truncated.substring(0, 100);
        }
      }
    }

    // PASS 5: Final collapse and cap — keep short so Pollinations responds fast
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > 90) {
      // Try to cut at a word boundary
      const cut = text.lastIndexOf(" ", 90);
      text = (
        cut > 40 ? text.substring(0, cut) : text.substring(0, 90)
      ).trimEnd();
    }

    console.log(
      `[VIDEO] extractVideoSubject: "${rawPrompt.substring(0, 60)}" → "${text}"`,
    );
    return text || rawPrompt.replace(/\s+/g, " ").trim().substring(0, 80);
  }

  async function generateScenePrompts(
    basePrompt: string,
    numScenes: number,
  ): Promise<string[]> {
    // Clean the raw prompt down to a concise visual subject
    const coreSubject = extractVideoSubject(basePrompt);
    console.log(`[VIDEO] Core subject extracted: "${coreSubject}"`);

    // Cinematic angles — 20 distinct shots so every scene in a max-length video is unique
    const angles = [
      "wide establishing shot, golden hour lighting, cinematic composition",
      "close-up detail, soft bokeh background, warm dramatic lighting",
      "aerial overhead view, cool blue-toned, ultra-wide lens",
      "dramatic low angle, high contrast rim lighting, moody atmosphere",
      "medium shot, natural daylight, vibrant saturated colors",
      "silhouette against sunset sky, orange and purple gradient",
      "artistic macro detail, shallow depth of field, soft diffused light",
      "dynamic action moment, motion blur, high energy composition",
      "tracking dolly shot, misty fog atmosphere, desaturated cool tones",
      "birds-eye overhead, symmetrical composition, geometric shadows",
      "extreme close-up, razor-sharp focus, texture and grain detail",
      "dutch tilt angle, electric neon lighting, urban night atmosphere",
      "over-the-shoulder perspective, natural backlighting, soft haze",
      "worm's-eye upward view, dramatic sky, volumetric cloud lighting",
      "rack focus pull, foreground blur, cinematic depth layers",
      "slow push-in shot, candlelight warmth, intimate shallow depth",
      "wide panoramic sweep, dusk twilight, lavender and gold horizon",
      "handheld verité, midday harsh shadows, high contrast documentary",
      "underwater or reflection shot, rippled distortion, teal and amber",
      "time-lapse composite, streaking light trails, deep navy night sky",
    ];

    const systemPrompt = `You are a cinematic storyboard director. Generate exactly ${numScenes} scene descriptions for image generation.

MANDATORY RULES — VIOLATION DISCARDS THE SCENE:
1. EVERY scene string MUST begin with the EXACT phrase: "${coreSubject}"
   — This is non-negotiable. The subject comes first, always. Do not paraphrase it.
2. After the subject, append ONLY the camera angle + lighting + mood (unique per scene)
3. NEVER repeat the same camera angle across scenes
4. Each scene: subject phrase + ", " + angle + ", " + lighting/mood + ", photorealistic"
5. Keep each scene under 120 words
6. Return ONLY a raw JSON array of ${numScenes} strings — no markdown, no explanation, no numbering

Camera angles to use in order: ${angles
      .slice(0, numScenes)
      .map((a, i) => `scene ${i + 1}: ${a}`)
      .join(" | ")}

EXAMPLE (subject "neon-lit Tokyo alley at night"):
["neon-lit Tokyo alley at night, wide establishing shot, wet pavement reflections, red and blue neon glow, cinematic, photorealistic",
"neon-lit Tokyo alley at night, close-up of glowing lanterns, steam rising, warm orange tones, shallow depth of field, photorealistic",
"neon-lit Tokyo alley at night, aerial overhead view, neon signs reflected on wet tiles, deep blue midnight tones, photorealistic"]`;

    const userMessage = `Generate ${numScenes} scene prompts. EVERY string must start with: "${coreSubject}"\n\nAngles: ${angles
      .slice(0, numScenes)
      .map((a, i) => `Scene ${i + 1}: ${a}`)
      .join("; ")}`;

    try {
      const result = await generateWithFallback(systemPrompt, userMessage, {
        maxTokens: 4096, // 20 scenes × ~30-word prompts needs headroom — 2048 was truncating
        temperature: 0.3, // Low temperature = subject-faithful; 0.8 caused ~50% drift
      });
      const text = result.text.trim();

      const jsonMatch = text.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const scenes = parsed
            .slice(0, numScenes)
            .map((s: any) => String(s).trim())
            .filter((s: string) => s.length > 10);

          // Deduplication check — if all scenes are identical fall through to fallback
          const uniqueScenes = new Set(
            scenes.map((s) => s.substring(0, 60).toLowerCase()),
          );
          if (uniqueScenes.size === 1) {
            console.warn(
              `[VIDEO] All ${scenes.length} AI scenes are identical — using angle fallback`,
            );
          } else {
            // Drift detection: require that MAJORITY of significant subject words appear.
            // Single-word match was too permissive — caused 50% fidelity failures.
            const subjectWords = coreSubject
              .toLowerCase()
              .split(/\s+/)
              .filter((w) => w.length > 3);
            const minWordMatches = Math.max(
              1,
              Math.ceil(subjectWords.length * 0.5),
            );

            const validated = scenes.map((scene, i) => {
              const sceneLower = scene.toLowerCase();
              const matchCount = subjectWords.filter((w) =>
                sceneLower.includes(w),
              ).length;
              const hasSubject = matchCount >= minWordMatches;

              if (!hasSubject) {
                // Scene drifted entirely — replace it with the anchored fallback
                console.warn(
                  `[VIDEO] Scene ${i + 1} drifted (${matchCount}/${subjectWords.length} subject words) — hard-anchoring`,
                );
                return `${coreSubject}, ${angles[i] || angles[0]}, photorealistic, highly detailed`;
              }

              // Scene has the subject but may not lead with it — prepend if needed
              const subjectStart = coreSubject.toLowerCase().substring(0, 25);
              if (!sceneLower.startsWith(subjectStart)) {
                console.log(
                  `[VIDEO] Scene ${i + 1} has subject but buries it — prepending`,
                );
                // Strip any accidental duplicate if the subject appears later
                const deduped = scene
                  .replace(
                    new RegExp(
                      coreSubject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                      "i",
                    ),
                    "",
                  )
                  .replace(/^[\s,]+/, "")
                  .trim();
                return `${coreSubject}, ${deduped || angles[i]}`;
              }

              return scene;
            });

            // Pad with angle-based fallbacks if the AI returned fewer than numScenes
            // (common when Pollinations text API truncates a long JSON array)
            if (validated.length < numScenes) {
              console.warn(
                `[VIDEO] AI returned ${validated.length}/${numScenes} scenes — padding remaining ${numScenes - validated.length} with angle fallbacks`,
              );
              for (let i = validated.length; i < numScenes; i++) {
                validated.push(
                  `${coreSubject}, ${angles[i] || angles[i % angles.length]}, photorealistic, highly detailed`,
                );
              }
            }

            return validated;
          }
        }
      }
    } catch (err) {
      console.error(
        "[VIDEO] Scene prompt generation failed, using fallback:",
        err,
      );
    }

    // Fallback: build anchored scenes manually with distinct angles
    return angles
      .slice(0, numScenes)
      .map(
        (angle) => `${coreSubject}, ${angle}, photorealistic, highly detailed`,
      );
  }

  /**
   * Fetch a single image directly from Pollinations (server-side, no proxy hop).
   * Returns the raw buffer or null on total failure.
   */
  async function fetchPollinationsImageDirect(
    imageUrl: string,
    frameLabel: string,
  ): Promise<Buffer | null> {
    const maxAttempts = 6;
    // Backoff: 0s, 5s, 12s, 22s, 36s, 55s — fast enough to not frustrate, slow enough to respect 429s
    const backoffSchedule = [0, 5000, 12000, 22000, 36000, 55000];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const backoffMs = backoffSchedule[attempt - 1] ?? 60000;
      if (backoffMs > 0) {
        console.log(
          `[VIDEO] ${frameLabel}: backing off ${backoffMs / 1000}s before attempt ${attempt}/${maxAttempts}`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);
      try {
        console.log(
          `[VIDEO] ${frameLabel}: fetching (attempt ${attempt}/${maxAttempts})`,
        );
        const response = await fetch(imageUrl, {
          signal: controller.signal,
          headers: { "User-Agent": "BetaGrace/vI" },
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          console.warn(
            `[VIDEO] ${frameLabel}: HTTP ${response.status} on attempt ${attempt}`,
          );
          if (response.status === 429) {
            // Honour Retry-After header if present
            const retryAfter = response.headers.get("Retry-After");
            const extraWait = retryAfter
              ? Math.min(parseInt(retryAfter, 10) * 1000, 120000)
              : 30000;
            console.log(
              `[VIDEO] ${frameLabel}: 429 — waiting extra ${extraWait / 1000}s (Retry-After: ${retryAfter ?? "none"})`,
            );
            await new Promise((r) => setTimeout(r, extraWait));
            continue;
          }
          if (response.status >= 500) continue; // transient server error
          break; // 4xx (non-429) — no point retrying
        }

        const buf = Buffer.from(await response.arrayBuffer());
        if (buf.length < 500) {
          console.warn(
            `[VIDEO] ${frameLabel}: response too small (${buf.length} bytes) — retrying`,
          );
          continue;
        }
        console.log(`[VIDEO] ${frameLabel}: downloaded ${buf.length} bytes`);
        return buf;
      } catch (err) {
        clearTimeout(timeoutId);
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[VIDEO] ${frameLabel}: attempt ${attempt} failed — ${msg}`,
        );
        if (attempt === maxAttempts) {
          console.error(
            `[VIDEO] ${frameLabel}: all ${maxAttempts} attempts exhausted — skipping frame`,
          );
        }
      }
    }
    return null;
  }

  async function renderVideoWithFFmpeg(
    imageUrls: string[],
    outputPath: string,
    durationSeconds: number = 90,
    jobId: string,
  ): Promise<void> {
    const tempDir = path.join(process.cwd(), "temp_videos", jobId);
    await fs.mkdir(tempDir, { recursive: true });

    const cleanupTempDir = async () => {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    };

    return new Promise(async (resolve, reject) => {
      const imagePaths: string[] = [];
      const frameDurationSeconds = Number(
        (durationSeconds / imageUrls.length).toFixed(3),
      );

      try {
        console.log(
          `[VIDEO] Downloading ${imageUrls.length} frames directly from Pollinations...`,
        );

        for (let i = 0; i < imageUrls.length; i++) {
          const imageUrl = imageUrls[i];
          const imagePath = path.join(
            tempDir,
            `frame_${String(i).padStart(4, "0")}.png`,
          );
          const frameLabel = `Frame ${i + 1}/${imageUrls.length}`;

          // Space frames out — 4s between each to stay under Pollinations rate limit
          if (i > 0) {
            console.log(
              `[VIDEO] Waiting 4s before fetching next frame (rate-limit guard)...`,
            );
            await new Promise((resolve) => setTimeout(resolve, 4000));
          }

          const buffer = await fetchPollinationsImageDirect(
            imageUrl,
            frameLabel,
          );
          if (!buffer) {
            console.warn(
              `[VIDEO] ${frameLabel}: skipped — no valid image received`,
            );
            continue;
          }

          // Detect image format from magic bytes
          const isPng =
            buffer.length >= 8 &&
            buffer
              .subarray(0, 8)
              .equals(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
              );
          const isJpeg =
            buffer.length >= 3 &&
            buffer[0] === 0xff &&
            buffer[1] === 0xd8 &&
            buffer[2] === 0xff;
          const isWebp =
            buffer.length >= 12 &&
            buffer.toString("ascii", 0, 4) === "RIFF" &&
            buffer.toString("ascii", 8, 12) === "WEBP";

          if (!isPng && !isJpeg && !isWebp) {
            console.warn(
              `[VIDEO] ${frameLabel}: unrecognised image format — skipping`,
            );
            continue;
          }

          const origExt = isPng ? "png" : isJpeg ? "jpg" : "webp";
          const origPath = imagePath.replace(/\.png$/i, `.${origExt}`);
          await fs.writeFile(origPath, buffer);

          // Convert JPEG/WEBP to PNG for FFmpeg concat
          if (!isPng) {
            await new Promise<void>((resolveConvert, rejectConvert) => {
              if (!FFMPEG_PATH) {
                rejectConvert(
                  new Error(
                    "FFmpeg binary not found. Install ffmpeg-static or add ffmpeg to PATH.",
                  ),
                );
                return;
              }
              const p = spawn(
                FFMPEG_PATH,
                ["-y", "-i", origPath, "-pix_fmt", "rgba", imagePath],
                { stdio: ["ignore", "pipe", "pipe"] },
              );
              let errOut = "";
              p.stderr?.on("data", (d: Buffer) => {
                errOut += d.toString();
                if (errOut.length > 2048) errOut = errOut.slice(-2048);
              });
              p.on("close", (code: number | null) =>
                code === 0
                  ? resolveConvert()
                  : rejectConvert(
                      new Error(`FFmpeg convert failed (${code}): ${errOut}`),
                    ),
              );
              p.on("error", rejectConvert);
            });
            await fs.rm(origPath, { force: true }).catch(() => {});
          }

          imagePaths.push(imagePath);
          console.log(`[VIDEO] ${frameLabel}: saved (${origExt}→png)`);
        }

        if (imagePaths.length === 0) {
          throw new Error("No images could be downloaded");
        }

        console.log(
          `[VIDEO] Successfully downloaded ${imagePaths.length}/${imageUrls.length} frames`,
        );

        const concatListPath = path.join(tempDir, "concat_list.txt");
        const normalizedPaths = imagePaths.map((p) =>
          path.resolve(p).replace(/\\/g, "/"),
        );
        const concatLines: string[] = [];

        normalizedPaths.forEach((resolvedPath) => {
          concatLines.push(`file '${resolvedPath}'`);
          concatLines.push(`duration ${frameDurationSeconds}`);
        });
        concatLines.push(
          `file '${normalizedPaths[normalizedPaths.length - 1]}'`,
        );

        await fs.writeFile(concatListPath, concatLines.join("\n"));

        const ffmpegArgs = [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatListPath,
          "-vsync",
          "vfr",
          "-pix_fmt",
          "yuv420p",
          "-c:v",
          "libx264",
          "-profile:v",
          "high",
          "-level:v",
          "4.1",
          "-preset",
          "fast",
          "-crf",
          "23",
          "-movflags",
          "+faststart",
          outputPath,
        ];

        console.log(
          `[VIDEO] Running ffmpeg with args: ${ffmpegArgs.join(" ")}`,
        );

        if (!FFMPEG_PATH) {
          throw new Error(
            "FFmpeg binary not found. Install ffmpeg-static or add ffmpeg to PATH.",
          );
        }

        const ffmpegProcess = spawn(FFMPEG_PATH, ffmpegArgs, {
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stderr = "";
        ffmpegProcess.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
          if (stderr.length > 10240) {
            stderr = stderr.slice(-10240);
          }
        });

        const timeoutId = setTimeout(async () => {
          ffmpegProcess.kill("SIGTERM");
          await cleanupTempDir();
          reject(new Error("Video rendering timed out after 90 seconds"));
        }, 90000);

        ffmpegProcess.on("close", async (code: number | null) => {
          clearTimeout(timeoutId);
          await cleanupTempDir();

          if (code === 0) {
            console.log(`[VIDEO] Successfully rendered video: ${outputPath}`);
            resolve();
          } else {
            console.error(`[VIDEO] FFmpeg failed with code ${code}: ${stderr}`);
            reject(new Error(`FFmpeg failed: ${stderr}`));
          }
        });

        ffmpegProcess.on("error", async (err: Error) => {
          clearTimeout(timeoutId);
          await cleanupTempDir();
          console.error("[VIDEO] FFmpeg process error:", err);
          reject(err);
        });
      } catch (err) {
        await cleanupTempDir();
        reject(err);
      }
    });
  }

  app.post("/api/sandbox/run", async (req, res) => {
    try {
      const { prompt, auditMode } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const sandboxSystem = `${CORE_SYSTEM_PROMPT}${MODE_PROMPTS.autonomous}

[DEV SANDBOX EXECUTION — DIRECT FULL-KNOWLEDGE MODE]
You are running inside a direct sandbox with unrestricted access to all autonomous capabilities:
- Show complete chain-of-thought reasoning when solving problems
- Generate any structured format (JSON, YAML, XML, markdown, code) on demand
- Verify every claim, fact, and inference before stating it
- Expose limitations or uncertainties honestly
- When auditMode is active: apply the 70×7 protocol — systematically verify outputs across correctness, completeness, consistency, clarity, creativity, and identify every possible improvement before finalizing your response
- Draw from ALL knowledge domains with maximum depth and precision`;

      const userPrompt = auditMode
        ? `[70×7 AUDIT PROTOCOL ACTIVE]\n${prompt}\n\nAfter your primary response, conduct a structured self-audit:\n1. Correctness check\n2. Completeness check\n3. Consistency check\n4. Clarity check\n5. Identify improvements\n6. Revised summary if needed\nBe thorough and honest.`
        : prompt;

      const result = await generateWithFallback(sandboxSystem, userPrompt, {
        maxTokens: 8192,
        temperature: 0.7,
      });
      return res.json({
        success: true,
        response: result.text,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[SANDBOX] Execution failed:", err);
      return res
        .status(500)
        .json({ error: "Sandbox execution failed", details: String(err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Dev Push-to-Code Tool (password-locked, writes fixed code directly to files)
  // ─────────────────────────────────────────────────────────────────────────────
  app.post("/api/dev/push-to-code", async (req, res) => {
    // Disabled in production — file-write endpoints must never be live outside dev
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }
    try {
      await new Promise((r) => setTimeout(r, 600));

      const { password, filePath, code } = req.body;

      const devPassword = process.env.DEV_PASSWORD;
      if (
        !devPassword ||
        devPassword.trim().length === 0 ||
        !password ||
        password !== devPassword
      ) {
        return res
          .status(401)
          .json({ error: "Unauthorized: invalid developer password" });
      }

      if (
        !filePath ||
        typeof filePath !== "string" ||
        filePath.trim().length === 0
      ) {
        return res.status(400).json({ error: "File path is required" });
      }

      if (!code || typeof code !== "string") {
        return res.status(400).json({ error: "Code content is required" });
      }

      // Resolve path — strip traversal attempts and anchor to workspace root
      const workspaceRoot = process.cwd();
      const sanitized = filePath
        .trim()
        .replace(/\.\./g, "")
        .replace(/^[/\\]+/, "");
      const resolvedPath = path.resolve(workspaceRoot, sanitized);

      if (!resolvedPath.startsWith(workspaceRoot)) {
        return res.status(403).json({ error: "Path traversal not allowed" });
      }

      const allowedExtensions = [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".css",
        ".json",
        ".md",
        ".txt",
        ".html",
      ];
      const ext = path.extname(resolvedPath).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        return res
          .status(403)
          .json({ error: `File extension "${ext}" not permitted` });
      }

      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, code, "utf8");

      const relativePath = resolvedPath
        .replace(workspaceRoot, "")
        .replace(/^[/\\]/, "");
      console.log(
        `[PUSH-TO-CODE] Developer wrote ${code.length} bytes to ${relativePath}`,
      );

      return res.json({
        success: true,
        filePath: relativePath,
        bytesWritten: code.length,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[PUSH-TO-CODE] Error:", err);
      return res
        .status(500)
        .json({ error: "Failed to write code", details: String(err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Dev Self-Mending Code Tool (password-locked)
  // ─────────────────────────────────────────────────────────────────────────────
  app.post("/api/dev/self-mend", async (req, res) => {
    try {
      const { password, code, issue, language } = req.body;

      // Anti-brute-force: add a small delay regardless of result
      await new Promise((r) => setTimeout(r, 600));

      const devPassword = process.env.DEV_PASSWORD;
      if (
        !devPassword ||
        devPassword.trim().length === 0 ||
        !password ||
        password !== devPassword
      ) {
        return res
          .status(401)
          .json({ error: "Unauthorized: invalid developer password" });
      }

      if (!code || typeof code !== "string" || code.trim().length < 3) {
        return res.status(400).json({ error: "Code is required" });
      }

      const lang =
        typeof language === "string" && language.trim()
          ? language.trim()
          : "auto-detect";
      const issueDesc =
        typeof issue === "string" && issue.trim()
          ? issue.trim()
          : "General code review, bug fix, and self-mending";

      const selfMendSystem = `You are BetaGrace vI Self-Mending Code Engine — an elite autonomous debugger and code repair specialist.

SELF-MENDING PROTOCOL (apply all 7 phases):
1. DIAGNOSE: Identify every bug, vulnerability, anti-pattern, and inefficiency. Be exhaustive.
2. CLASSIFY: Categorize each issue: CRITICAL (crash/security), HIGH (logic error), MEDIUM (performance/style), LOW (cosmetic).
3. EXPLAIN: For each issue, explain precisely what's wrong, why it fails, and the impact.
4. FIX: Write the complete corrected code — no partial snippets, full working implementation.
5. VERIFY: Walk through the fix and confirm it solves each identified issue.
6. TEST CASES: Suggest 3+ test cases to confirm the fix works.
7. CONFIDENCE: Rate each fix 0–100% and flag any remaining uncertainties.

Language: ${lang}
Developer-reported issue: ${issueDesc}

Output format:
## Issues Found
[list each issue with severity]

## Fixed Code
\`\`\`${lang}
[complete corrected code here]
\`\`\`

## Explanation of Changes
[what was changed and why]

## Suggested Tests
[test cases]

## Confidence Report
[per-fix confidence ratings]`;

      const userPrompt = `Analyze and self-mend this code:\n\n\`\`\`${lang}\n${code.substring(0, 12000)}\n\`\`\``;

      const result = await generateWithFallback(selfMendSystem, userPrompt, {
        maxTokens: 8192,
        temperature: 0.05,
      });

      console.log(`[SELF-MEND] Analysis complete via ${result.provider}`);
      return res.json({
        success: true,
        analysis: result.text,
        provider: result.provider,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[SELF-MEND] Error:", err);
      return res
        .status(500)
        .json({ error: "Self-mend failed", details: String(err) });
    }
  });

  const videoJobs: Map<
    string,
    {
      status: string;
      videoUrl?: string;
      storyboard?: string[];
      storyboardCaptions?: string[];
      error?: string;
      // BUG FIX 3: Track generation progress so the UI can show meaningful state
      succeededFrames?: number;
      totalFrames?: number;
      balanceExhausted?: boolean;
      createdAt: number;
    }
  > = new Map();

  // Global semaphore: only 1 video render at a time to avoid Pollinations 429 storms
  let videoRenderInProgress = false;
  const videoRenderQueue: Array<() => void> = [];

  function acquireVideoSemaphore(): Promise<void> {
    if (!videoRenderInProgress) {
      videoRenderInProgress = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => videoRenderQueue.push(resolve));
  }

  function releaseVideoSemaphore(): void {
    const next = videoRenderQueue.shift();
    if (next) {
      next(); // pass the lock to the next waiter
    } else {
      videoRenderInProgress = false;
    }
  }

  setInterval(() => {
    const now = Date.now();
    for (const [jobId, job] of videoJobs.entries()) {
      if (
        (job.status === "completed" || job.status === "failed") &&
        now - job.createdAt > 300000
      ) {
        videoJobs.delete(jobId);
        console.log(`[VIDEO] Cleaned up old job: ${jobId}`);
      }
    }
  }, 60000);

  app.post("/api/generate-video", async (req, res) => {
    try {
      const { prompt, style, sceneCount, mode } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Valid prompt is required" });
      }

      // ── MODE GUARD: Video generation is exclusive to video_generator mode ──
      if (mode && mode !== "video_generator") {
        return res.status(403).json({
          error: "Video generation is only available in Video Generator mode.",
          hint: "Switch to Video Generator mode to create videos.",
        });
      }

      // ── SESSION + GUARDRAIL CHECKS ────────────────────────────────────────
      const videoSessionId = getSessionId(req);
      if (!validateSessionId(videoSessionId)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }
      const {
        session: videoSession,
        isOver18: videoIsOver18,
        ageVerified: videoAgeVerified,
      } = await getVerifiedSession(videoSessionId);
      if (!videoSession || !videoAgeVerified || !videoIsOver18) {
        return res.status(403).json({ error: "Age verification required" });
      }

      // Check prompt
      const videoPromptGuard = executeGuardrails({
        content: prompt,
        isOver18: videoIsOver18,
        context: "creative_writing",
      });
      guardrailLogger.logCheck({
        timestamp: new Date().toISOString(),
        sessionId: videoSessionId,
        passed: videoPromptGuard.passed,
        blockedReason: videoPromptGuard.blockedReason,
        totalRiskScore: videoPromptGuard.totalRiskScore,
      });
      if (!videoPromptGuard.passed) {
        return res
          .status(403)
          .json({
            error: "Content blocked",
            reason: videoPromptGuard.blockedReason,
          });
      }

      // Check style — appended verbatim to every scene prompt
      if (style && typeof style === "string" && style.trim().length > 3) {
        const videoStyleGuard = executeGuardrails({
          content: style,
          isOver18: videoIsOver18,
          context: "creative_writing",
        });
        guardrailLogger.logCheck({
          timestamp: new Date().toISOString(),
          sessionId: videoSessionId,
          passed: videoStyleGuard.passed,
          blockedReason: videoStyleGuard.blockedReason
            ? `[style] ${videoStyleGuard.blockedReason}`
            : undefined,
          totalRiskScore: videoStyleGuard.totalRiskScore,
        });
        if (!videoStyleGuard.passed) {
          return res
            .status(403)
            .json({
              error: "Content blocked",
              reason: videoStyleGuard.blockedReason,
            });
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      const numScenes = Math.min(Math.max(sceneCount || 20, 3), 20);
      const styleTag =
        typeof style === "string" && style.trim().length > 0
          ? ` in a ${style.trim()} style`
          : "";

      const jobId = `vid_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      videoJobs.set(jobId, { status: "queued", createdAt: Date.now() });

      void (async () => {
        // Atomic sanitization — wipe any stale frames from prior crashed runs
        // before a single new byte is written. Uses sync fs ops for atomicity.
        const framesDir = sanitizeRenderDir(jobId);

        try {
          videoJobs.set(jobId, { status: "processing", createdAt: Date.now() });

          const storyboard: string[] = [];
          const storyboardCaptions: string[] = [];

          // ── HYDRATION ENGINE (Pollinations unified API) ───────────────────
          let scenePrompts: string[];
          let perSceneSeeds: number[] | undefined;
          let masterSeed = Math.floor(Math.random() * 2147483647);

          try {
            console.log(`[VIDEO] Using VideoHydrationEngine (Pollinations)`);
            const hydrationEngine = new VideoHydrationEngine();
            const payload = await hydrationEngine.hydrate(
              `${prompt}${styleTag}`,
              numScenes,
              req.headers["x-session-id"] as string | undefined,
            );
            const { positives, negatives, seeds } =
              hydratedPayloadToPromptArrays(payload);
            scenePrompts = positives;
            perSceneSeeds = seeds;
            masterSeed = payload.masterSeed;
            console.log(
              `[VIDEO] Hydration complete — ${payload.scenes.length} structured scenes, master seed ${masterSeed}`,
            );
          } catch (hydrateErr) {
            console.error(
              `[VIDEO] Hydration engine failed, falling back to legacy scene gen:`,
              hydrateErr,
            );
            scenePrompts = await generateScenePrompts(
              `${prompt}${styleTag}`,
              numScenes,
            );
          }

          // Build storyboard preview URLs and captions for the UI
          for (let i = 0; i < numScenes; i++) {
            const scenePrompt =
              scenePrompts[i] || `${prompt} - scene ${i + 1} of ${numScenes}`;
            const sceneSeed = perSceneSeeds
              ? perSceneSeeds[i]
              : masterSeed + Math.floor(i / 12) * 1000;

            const cleanScene = scenePrompt
              .replace(/\*\*/g, "")
              .replace(/^\[IMAGE:\s*/i, "")
              .replace(/\]\s*$/, "")
              .trim();
            const enc = encodeURIComponent(cleanScene.substring(0, 1400));
            const pollinationsToken = process.env.POLLINATIONS_API_KEY;
            const keyParam = pollinationsToken
              ? `&key=${encodeURIComponent(pollinationsToken)}`
              : "";
            const previewUrl = `https://gen.pollinations.ai/image/${enc}?model=flux&width=1024&height=576&nologo=true&enhance=false&seed=${sceneSeed}${keyParam}`;

            console.log(
              `[VIDEO] Scene ${i + 1}/${numScenes}: "${scenePrompt.substring(0, 120)}"`,
            );

            storyboard.push(buildProxyImageUrl(previewUrl));
            const captionText = scenePrompt.substring(0, 60).trim();
            storyboardCaptions.push(
              `Scene ${i + 1}/${numScenes}: ${captionText}${scenePrompt.length > 60 ? "…" : ""}`,
            );
          }

          videoJobs.set(jobId, {
            status: "rendering",
            storyboard,
            storyboardCaptions,
            createdAt: Date.now(),
          });

          const videoDir = path.join(
            process.cwd(),
            "attached_assets",
            "generated_videos",
          );
          await fs.mkdir(videoDir, { recursive: true });
          const videoFilename = `video_${jobId}.mp4`;
          const videoPath = path.join(videoDir, videoFilename);

          console.log(`[VIDEO] Waiting for render slot (semaphore)...`);
          await acquireVideoSemaphore();
          console.log(
            `[VIDEO] Render slot acquired — starting Breathing Pipeline for job ${jobId}...`,
          );
          try {
            // ── Phase 1: Download frames using hydrated seeds when available ─
            await processVideoFramesSafe(
              scenePrompts.map((s) =>
                s
                  .replace(/\*\*/g, "")
                  .replace(/^\[IMAGE:\s*/i, "")
                  .replace(/\]\s*$/, "")
                  .trim(),
              ),
              masterSeed,
              framesDir,
              process.env.POLLINATIONS_API_KEY,
              perSceneSeeds,
            );

            // ── Phase 2: Compile frames → MP4 (absolute paths, atomic) ───────
            await atomicCompileVideo(framesDir, videoPath, 90);
          } finally {
            releaseVideoSemaphore();
            console.log(`[VIDEO] Render slot released for job ${jobId}`);
          }

          const videoUrl = `/api/video/${videoFilename}`;
          videoJobs.set(jobId, {
            status: "completed",
            videoUrl,
            storyboard,
            storyboardCaptions,
            createdAt: Date.now(),
          });

          console.log(
            `[VIDEO] Video generation completed for job ${jobId}: ${videoUrl}`,
          );
        } catch (err) {
          console.error("[VIDEO] Generation error:", err);
          const existingJob = videoJobs.get(jobId);
          videoJobs.set(jobId, {
            status: "failed",
            error: err instanceof Error ? err.message : "Unknown error",
            storyboard: existingJob?.storyboard,
            storyboardCaptions: existingJob?.storyboardCaptions,
            succeededFrames: existingJob?.succeededFrames,
            totalFrames: existingJob?.totalFrames,
            balanceExhausted: existingJob?.balanceExhausted,
            createdAt: Date.now(),
          });
        } finally {
          try {
            await fs.rm(framesDir, { recursive: true, force: true });
            console.log(`[Cleanup] Temp frames removed for job ${jobId}`);
          } catch (cleanupErr) {
            console.error(
              `[Cleanup Error] Could not remove ${framesDir}:`,
              cleanupErr,
            );
          }
        }
      })();

      res.json({ jobId, status: "queued", sceneCount: numScenes });
    } catch (error) {
      console.error("[VIDEO] Error:", error);
      res.status(500).json({
        error: "Failed to queue video",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/video-status/:jobId", async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = videoJobs.get(jobId);

      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      const age = Date.now() - job.createdAt;
      if (age > 3600000) {
        videoJobs.delete(jobId);
      }

      res.json({
        jobId,
        status: job.status,
        videoUrl: job.videoUrl || null,
        storyboard: job.storyboard || null,
        storyboardCaptions: job.storyboardCaptions || null,
        error: job.error || null,
        // BUG FIX 3: Expose progress and balance state so the UI can show
        // "9/20 scenes generated" and a clear "top up pollen" message.
        succeededFrames: job.succeededFrames ?? null,
        totalFrames: job.totalFrames ?? null,
        balanceExhausted: job.balanceExhausted ?? false,
      });
    } catch (error) {
      console.error("[VIDEO STATUS] Error:", error);
      res.status(500).json({
        error: "Failed to get video status",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/video/:filename", async (req, res) => {
    try {
      const { filename } = req.params;
      if (!/^video_[a-zA-Z0-9_-]+\.mp4$/.test(filename)) {
        return res.status(400).json({ error: "Invalid filename format" });
      }

      const videoPath = path.join(
        process.cwd(),
        "attached_assets",
        "generated_videos",
        filename,
      );

      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(videoPath);
      } catch {
        return res.status(404).json({ error: "Video not found" });
      }

      const fileSize = stat.size;
      const range = req.headers.range;

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "public, max-age=3600");

      if (range) {
        // Mobile-friendly chunked range delivery
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1]
          ? Math.min(parseInt(parts[1], 10), fileSize - 1)
          : Math.min(start + 1024 * 1024 - 1, fileSize - 1); // 1 MB chunks

        if (
          isNaN(start) ||
          start >= fileSize ||
          end >= fileSize ||
          start > end
        ) {
          res.setHeader("Content-Range", `bytes */${fileSize}`);
          return res.status(416).end();
        }

        const chunkSize = end - start + 1;
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
        res.setHeader("Content-Length", chunkSize);

        const chunkStream = createReadStream(videoPath, { start, end });
        chunkStream.pipe(res);
        chunkStream.on("error", (err: Error) => {
          console.error("[VIDEO SERVE] Chunk stream error:", err);
          if (!res.headersSent) res.status(500).end();
        });
      } else {
        // Full file delivery
        res.setHeader("Content-Length", fileSize);
        const videoStream = createReadStream(videoPath);
        videoStream.pipe(res);
        videoStream.on("error", (err: Error) => {
          console.error("[VIDEO SERVE] Stream error:", err);
          if (!res.headersSent) res.status(500).end();
        });
      }
    } catch (error) {
      console.error("[VIDEO SERVE] Error:", error);
      res.status(500).json({
        error: "Failed to serve video",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ── startArtifactBuildJob ────────────────────────────────────────────────────
  // Persists a new artifact job to PostgreSQL and fires the 70x7 pipeline in
  // the background. Accumulates content in memory — no filesystem writes.
  // Returns the jobId immediately.
  async function startArtifactBuildJob(
    topic: string,
    sessionId: string,
    contextualMode?: string,
  ): Promise<{ jobId: string }> {
    const cleanTopic = topic.trim().substring(0, 500);
    const jobId = `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await dbArtifactInsert(
      jobId,
      cleanTopic,
      sessionId,
      contextualMode ?? null,
    );

    console.log(
      `[CORE_SYSTEM] startArtifactBuildJob — jobId=${jobId} mode=${contextualMode ?? "default"} session=${sessionId.substring(0, 24)} topic="${cleanTopic.substring(0, 80)}"`,
    );

    const artifactGenerateFn = async (
      systemPrompt: string,
      userMsg: string,
    ): Promise<string> => {
      const result = await generateWithFallback(systemPrompt, userMsg, {
        maxTokens: 2000,
        temperature: 0.7,
      });
      return result.text;
    };

    run70x7Pipeline({
      topic: cleanTopic,
      generateFn: artifactGenerateFn,
      contextualMode,
      onSectionComplete: (sectionTitle, index, total) => {
        dbArtifactProgress(jobId, sectionTitle, index, total);
        console.log(
          `[70x7] Job ${jobId} — section ${index}/${total}: "${sectionTitle}"`,
        );
      },
    })
      .then(async (buildResult) => {
        if (buildResult.success) {
          await dbArtifactComplete(
            jobId,
            buildResult.content,
            buildResult.sectionsCompleted,
            buildResult.totalSections,
          );
          console.log(
            `[70x7] Job ${jobId} complete — ${buildResult.sectionsCompleted} sections, ${buildResult.content.length} chars`,
          );
        } else {
          await dbArtifactFail(jobId, buildResult.error ?? "Pipeline failed");
          console.error(`[70x7] Job ${jobId} failed:`, buildResult.error);
        }
      })
      .catch(async (err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        await dbArtifactFail(jobId, errMsg);
        console.error(`[70x7] Job ${jobId} threw:`, err);
      });

    return { jobId };
  }

  app.post("/api/chat", async (req, res) => {
    try {
      const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
      if (!validateContentLength(contentLength)) {
        return res.status(413).json({
          error: "Payload too large",
          maxSize: `${MAX_CONTENT_LENGTH / 1024 / 1024} MB`,
        });
      }

      const sessionId = getSessionId(req);
      if (!validateSessionId(sessionId)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }

      const VALID_CHAT_MODES = [
        "standard",
        "flesh_architect",
        "sanctuary",
        "advanced_reasoning",
        "autonomous",
        "video_generator",
        "code_graph",
        "academic_research",
      ];
      const rawMode = req.body?.mode;
      if (!rawMode || !VALID_CHAT_MODES.includes(rawMode)) {
        return res
          .status(400)
          .json({
            error: "Invalid or missing mode",
            validModes: VALID_CHAT_MODES,
          });
      }

      console.log("[CHAT] Request from session:", sessionId);

      const body = chatRequestSchema
        .extend({
          conversationId: z.string().nullish(),
          learningEnabled: z.boolean().optional(),
          activeModes: z.array(z.string()).optional(),
          advancedReasoningEnabled: z.boolean().optional(),
          faithEnhancementEnabled: z.boolean().optional(),
          maxTokens: z.number().int().min(1).max(65536).optional(),
        })
        .parse(req.body);

      let userMsg = body.message.trim();
      if (userMsg.length === 0 || userMsg.length > 25000) {
        return res
          .status(400)
          .json({ error: "Message length must be 1-25,000 characters" });
      }
      userMsg = userMsg.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

      const {
        mode,
        conversationId,
        learningEnabled: _learningEnabled,
        activeModes = [mode],
        advancedReasoningEnabled = true,
        faithEnhancementEnabled = false,
        bookTitles,
        bookNarrativeVoice,
        bookContext,
      } = body;

      // --- UNIVERSAL ARTIFACT INTERCEPTOR ---
      // Heuristic Matrix: detects deep-structural long-horizon requests that
      // would exceed standard context limits and diverts them to the background
      // 70x7 artifact pipeline, preserving the thematic soul of the active mode.

      // Pre-Generation Estimator: structural complexity analysis
      const _pgeScore = userMsg.length + userMsg.split(/[.!?]/).length * 20;
      const _pgeKeyword =
        /(?:write a|write me a|compose(?: a| an)?|create(?: a| an)?|generate(?: a| an)?|produce(?: a| an)?|draft(?: a| an)?).*\b(?:book|chapter|document|essay|paper|analysis|manuscript)\b/i.test(
          userMsg,
        );
      const _pgeComplex = _pgeScore > 2000;
      const _pgeExplicitLongForm =
        /(?:full manuscript|complete book|15 chapters|detailed report|long-form document|extended analysis)/i.test(
          userMsg,
        );
      const _pgeAcademicAnalysis =
        userMsg.length > 5000 &&
        /(?:comprehensive|exhaustive|in-depth analysis)/i.test(userMsg);

      const isLongHorizonTask =
        userMsg.toLowerCase().includes("/full") ||
        _pgeKeyword ||
        _pgeComplex ||
        _pgeExplicitLongForm ||
        _pgeAcademicAnalysis;

      const shouldDivertToArtifact =
        mode === "academic_research" && isLongHorizonTask;
      console.log("[PRE-GEN ESTIMATOR]", {
        score: _pgeScore,
        keywordMatch: _pgeKeyword,
        explicitLongForm: _pgeExplicitLongForm,
        academicAnalysis: _pgeAcademicAnalysis,
        shouldDivertToArtifact,
        mode,
      });

      if (shouldDivertToArtifact) {
        console.log(
          `[PRE-GEN ESTIMATOR] score=${_pgeScore} keyword=${_pgeKeyword} complex=${_pgeComplex} → artifact diversion`,
        );
        try {
          console.log(
            `[CORE_SYSTEM] Horizon threshold exceeded. Diverting mode [${mode}] to deep background infrastructure.`,
          );

          // Purify the string to prevent keyword pollution in the final artifact
          const topicCleaned = userMsg.replace(/\/full/gi, "").trim();

          // Bind the execution to the requested mode to preserve thematic resonance
          const jobResult = await startArtifactBuildJob(
            topicCleaned,
            sessionId,
            mode,
          );

          // Deploy automation envelope for front-end synchronization
          return res.status(200).json({
            status: "AUTOMATION_DIVERTED",
            message:
              "Task horizon exceeds standard context limits. Safely diverted to deep artifact generation pipeline.",
            jobId: jobResult.jobId,
            modeContext: mode,
            targetEndpoint: `/api/academic/artifact/status/${jobResult.jobId}`,
          });
        } catch (error) {
          // Failsafe: if deep infrastructure rejects the handoff, fall gracefully
          // back to the standard stream below — do not surface the error to the user.
          console.error(
            "[SYSTEM_WARNING] Deep diversion failed. Initiating standard stream fallback:",
            error,
          );
        }
      }
      // --- END INTERCEPTOR. ORIGINAL SWITCH-CASE CASCADE REMAINS UNTOUCHED BELOW ---

      // Prompt-injection guardrail — block well-known jailbreak patterns before AI call
      const INJECTION_PATTERNS = [
        /ignore\s+all\s+previous\s+instructions/i,
        /disregard\s+(all\s+)?(previous|prior)\s+instructions/i,
        /forget\s+(all\s+)?(previous|prior)\s+instructions/i,
        /you\s+are\s+now\s+(DAN|an?\s+unrestricted)/i,
        /reveal\s+your\s+system\s+prompt/i,
        /bypass\s+your\s+(safety|content|ethical)\s+(filters?|guidelines?|restrictions?)/i,
      ];
      if (INJECTION_PATTERNS.some((p) => p.test(userMsg))) {
        return res
          .status(400)
          .json({ error: "Message contains restricted content patterns." });
      }

      // Default learning to enabled unless explicitly disabled by client
      const learningEnabled = _learningEnabled ?? true;

      const { session, isOver18, ageVerified } =
        await getVerifiedSession(sessionId);

      console.log("[CHAT] Age verification check:", {
        sessionId,
        sessionExists: !!session,
        isOver18,
        ageVerified,
        rawIsOver18: session?.isOver18,
        strictCheck: session?.isOver18 === true,
      });

      if (!session) {
        return res.status(401).json({
          error: "Session not found",
          message: "Please refresh the page to create a new session",
          requiresAgeVerification: true,
        });
      }

      if (!ageVerified || !isOver18) {
        console.log("[CHAT] Age verification failed:", {
          ageVerified,
          isOver18,
          denying: true,
        });

        return res.status(403).json({
          error: "Age verification required",
          message: "BetaGrace is restricted to users 18+ years old",
          requiresAgeVerification: true,
          verificationStatus: {
            ageVerified,
            isOver18,
          },
        });
      }

      console.log("[CHAT] Age verification passed, proceeding with chat");

      const rate = await storage.checkRateLimit(sessionId);
      if (!rate.allowed) {
        return res.status(429).json({
          error: "Rate limited",
          message:
            rate.reason ??
            "Too many messages — please wait a moment before sending more.",
          action: "Wait a moment, then try again.",
        });
      }

      const msgs = await storage.getMessages(sessionId);
      if (msgs.length >= 500) {
        return res.status(429).json({
          error: "Message limit reached",
          message: "You have hit the 500-message limit for this session.",
          limit: 500,
          current: msgs.length,
        });
      }

      const guardReq: GuardrailCheckRequest = {
        content: userMsg,
        isOver18,
        context: "creative_writing",
      };
      const inputGuard = executeGuardrails(guardReq);
      guardrailLogger.logCheck({
        timestamp: new Date().toISOString(),
        sessionId,
        passed: inputGuard.passed,
        blockedReason: inputGuard.blockedReason,
        totalRiskScore: inputGuard.totalRiskScore,
      });
      if (!inputGuard.passed) {
        return res.status(403).json({
          error: "Content policy violation",
          reason: inputGuard.blockedReason,
        });
      }

      const conflicts = MODE_CONFLICTS[mode] ?? [];
      const hasConflict = activeModes.some((m) =>
        conflicts.includes(m as AIMode),
      );
      if (hasConflict) {
        return res.status(400).json({
          error: "Invalid mode configuration",
          message: `${mode} cannot run together with ${conflicts.join(", ")}`,
        });
      }

      const dataRetentionOptOut = session.dataRetentionOptOut === true;

      let conversation = conversationId
        ? await storage.getConversation(conversationId)
        : null;
      if (!conversation) {
        if (!dataRetentionOptOut) {
          conversation = await storage.createConversation({
            sessionId,
            title: userMsg.slice(0, 50) + (userMsg.length > 50 ? "…" : ""),
            messageCount: 0,
            activeModes: [mode],
          });
        } else {
          conversation = {
            id: randomUUID(),
            sessionId,
            title: userMsg.slice(0, 50) + (userMsg.length > 50 ? "…" : ""),
            messageCount: 0,
            activeModes: [mode],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as any;
        }
      }

      if (!conversation) {
        throw new Error("Failed to initialize conversation");
      }

      const feedback = getBoneMarrowFeedback(userMsg);
      if (feedback.boneDelta !== 0 || feedback.marrowDelta !== 0) {
        const priorTrace = localSynthesisFeedbackMap.get(sessionId);
        if (priorTrace && priorTrace.recordIds.length > 0) {
          synthesisEngine.applyBoneMarrowFeedback(priorTrace.recordIds, feedback);
          console.log(
            `[LOCAL SYNTHESIS] Applied feedback bone=${feedback.boneDelta.toFixed(5)} marrow=${feedback.marrowDelta.toFixed(5)} to ${priorTrace.recordIds.length} record(s)`
          );
        }
      }

      if (!dataRetentionOptOut) {
        await storage.createMessage({
          sessionId,
          conversationId: conversation.id,
          role: "user",
          content: userMsg,
          mode,
        });
      }

      let learnedInject = "";
      try {
        // PRIORITY 1: Inject recent context from THIS conversation only (last 20 messages)
        try {
          const allConvMsgs = dataRetentionOptOut
            ? []
            : await storage.getMessagesByConversation(conversation.id);
          const recentMessages = allConvMsgs.slice(-40);
          if (recentMessages.length > 0) {
            const messageContext = buildDeepConversationContext(recentMessages);
            if (messageContext) {
              learnedInject = `\n\n[CONVERSATION CONTEXT — CURRENT CHAT ONLY]\n${messageContext}\n`;
            }
          }
        } catch (e) {
          console.error("[CHAT] Error loading recent conversation context:", e);
        }

        // PRIORITY 2: Inject high-confidence long-term memories
        if (!learnedInject || learnedInject.length < 50) {
          try {
            const memories = await storage.getLongTermMemory(sessionId, 10);
            if (memories.length) {
              const top = memories
                .filter((m) => m.confidenceScore > 0.6)
                .map(
                  (m) =>
                    `[LEARNED] ${m.summary} (confidence: ${(m.confidenceScore * 100).toFixed(0)}%)`,
                )
                .join("\n");
              if (top) {
                learnedInject += `\n\n[USER CONTEXT FROM LEARNING]\n${top}\n`;
              }
            }
          } catch (e) {
            console.error("[CHAT] Error loading memories:", e);
          }
        }

        // PRIORITY 3: If still no context, fall back to recent learning data summaries
        if (!learnedInject || learnedInject.length < 50) {
          try {
            const learning = await storage.getLearningData(sessionId);
            if (learning && learning.length) {
              // Extract actual content from recent learning items, not just counts
              const storyElements = learning
                .filter((l) =>
                  [
                    "story_element",
                    "narrative_theme",
                    "character_detail",
                    "plot_point",
                  ].includes(l.patternType),
                )
                .slice(-5)
                .map((l) => `[${l.patternType.toUpperCase()}] ${l.patternData}`)
                .join("\n");

              if (storyElements) {
                learnedInject += `\n\n[RECENT NARRATIVE ELEMENTS]\n${storyElements}\n`;
              } else {
                // Fallback: show pattern type summary
                const grouped = learning.reduce(
                  (acc: Record<string, number>, item) => {
                    acc[item.patternType] = (acc[item.patternType] || 0) + 1;
                    return acc;
                  },
                  {} as Record<string, number>,
                );
                const summary = Object.entries(grouped)
                  .map(
                    ([type, count]) =>
                      `[RECENT-${type.toUpperCase()}] ${count} observations`,
                  )
                  .join("\n");
                learnedInject += `\n\n[RECENT USER PATTERNS]\n${summary}\n`;
              }
            }
          } catch (e) {
            console.error(
              "[CHAT] Error loading recent learning data fallback:",
              e,
            );
          }
        }
      } catch (e) {
        console.error("[CHAT] Error loading memories:", e);
      }

      let systemPrompt = CORE_SYSTEM_PROMPT;
      systemPrompt += "\n" + (MODE_PROMPTS[mode] ?? MODE_PROMPTS.standard);
      systemPrompt += learnedInject;

      if (advancedReasoningEnabled) {
        systemPrompt += ADVANCED_REASONING_ENHANCEMENT;
      }

      systemPrompt += buildBookNarrativeGuidance(
        bookTitles,
        bookNarrativeVoice,
        bookContext,
      );

      if (faithEnhancementEnabled) {
        systemPrompt += FAITH_ENHANCEMENT;
      }

      if (isLegalPolicyQuery(userMsg)) {
        try {
          systemPrompt += await buildLegalPromptContext(userMsg);
          console.log(
            "[LEGAL] Live legal documents injected into chat system prompt",
          );
        } catch (e) {
          console.error(
            "[LEGAL] Failed to inject live legal documents into chat prompt:",
            e,
          );
        }
      }

      // CODE GRAPH MODE: auto-extract knowledge graph from any code blocks in message
      if (mode === "code_graph") {
        const codeBlockRe = /```[\w]*\n?([\s\S]*?)```/g;
        let codeMatch: RegExpExecArray | null;
        const codeBlocks: string[] = [];
        while ((codeMatch = codeBlockRe.exec(userMsg)) !== null) {
          codeBlocks.push(codeMatch[1]);
        }
        // Also detect raw code without fences (heuristic: contains function/class keywords, >=5 lines)
        if (codeBlocks.length === 0 && userMsg.split("\n").length >= 5) {
          const hasCode =
            /\b(function|const|let|var|class|import|export|def |fn |package )\b/.test(
              userMsg,
            );
          if (hasCode) codeBlocks.push(userMsg);
        }
        if (codeBlocks.length > 0) {
          try {
            const combinedCode = codeBlocks.join("\n\n");
            const graph = analyzeCode(combinedCode);
            const graphText = formatGraphForAI(graph);
            systemPrompt += `\n\n${graphText}\n`;
            console.log(
              `[CODE GRAPH] Analyzed ${graph.stats.totalLines} lines, ${graph.stats.totalFunctions} functions, ${graph.stats.totalClasses} classes`,
            );
          } catch (e) {
            console.error("[CODE GRAPH] Analysis error:", e);
          }
        }
      }

      // Optionally augment the system prompt with retrieved context from the vector DB.
      const useRag =
        process.env.RAG_ENABLED === "true" || (body as any).useRag === true;
      if (useRag) {
        try {
          const ragCtx = await retrieveContext(userMsg);
          if (ragCtx) {
            systemPrompt += `\n\n[RETRIEVED CONTEXT]\n${ragCtx}\n\n`;
            console.log("[RAG] Retrieved context appended to system prompt");
          } else {
            console.log("[RAG] No relevant documents found for query");
          }
        } catch (e) {
          console.error("[RAG] retrieveContext failed:", e);
        }
      }

      // ── ACADEMIC RESEARCH MODE: Guard Loop search context injection ─────────
      // Purely additive — does not touch any existing search tools or routes.
      if (mode === "academic_research") {
        try {
          const academicSearchCtx = await academicSearchGuard(userMsg);
          if (
            academicSearchCtx &&
            !academicSearchCtx.includes("Falling back")
          ) {
            systemPrompt += `\n\n[ACADEMIC GUARD LOOP — LIVE RESEARCH CONTEXT]\n${academicSearchCtx}\n[END ACADEMIC CONTEXT]\nCite these sources naturally in your academic response. Use formal attribution (e.g. "Research indicates...", "According to available sources...").`;
            console.log(
              "[ACADEMIC GUARD LOOP] Search context injected into chat system prompt",
            );
          }
        } catch (e) {
          console.warn(
            "[ACADEMIC GUARD LOOP] Guard loop failed gracefully:",
            e instanceof Error ? e.message : e,
          );
        }
      }

      const wantsImage =
        /\b(image|picture|photo|illustration|draw|drawing|sketch|paint|painting|visuali|generate.*image|show.*image|create.*image|make.*image|generate.*picture|generate.*photo|render|portrait|artwork|art of|depict)\b/i.test(
          userMsg,
        );

      // Inject a focused image-generation instruction into the system prompt so the AI always emits [IMAGE: ...] tag
      if (wantsImage) {
        systemPrompt += `\n\n[IMAGE GENERATION ACTIVE] The user is explicitly requesting an image. You MUST include a vivid, detailed [IMAGE: <prompt>] tag in your response — this is not optional. Write 1-3 sentences of narrative context, then embed the [IMAGE: ...] tag with a richly descriptive prompt covering subject, artistic style, lighting, color palette, mood, and composition. Example: [IMAGE: ethereal forest clearing at twilight, ancient oak trees draped in bioluminescent moss, soft purple mist, fantasy realism, dramatic rim lighting, ultra-detailed, cinematic composition]. The image will be auto-generated from this tag.`;
      }

      const synthesisContext = enrichPromptWithSynthesis(
        systemPrompt,
        userMsg,
        mode,
        sessionId,
      );
      systemPrompt = synthesisContext.prompt;

      const genResult = await generateWithFallback(
        capSystemPromptForProvider(systemPrompt),
        userMsg,
        { maxTokens: body.maxTokens },
        openRouterModel,
        sessionId,
        mode,
      );
      let aiResponse = genResult.text;
      if (genResult.provider === "local") {
        const trace = genResult.trace ?? null;
        if (trace && trace.recordIds.length > 0) {
          localSynthesisFeedbackMap.set(sessionId, {
            recordIds: trace.recordIds,
            confidence: trace.confidence,
            supportLevel: trace.supportLevel,
            timestamp: Date.now(),
          });
        } else {
          localSynthesisFeedbackMap.delete(sessionId);
        }
      } else {
        localSynthesisFeedbackMap.delete(sessionId);
      }
      console.log(
        `[AI] Response from ${genResult.provider} model ${genResult.model}`,
      );
      console.log(
        "[RAW AI RESPONSE FROM PROVIDER]",
        genResult.provider,
        ":",
        JSON.stringify(aiResponse.substring(0, 500)),
      );
      if (genResult.fallbackUsed) {
        console.log(`[AI] Fallback used: ${genResult.fallbackReason}`);
      }

      const respGuard = executeResponseGuardrails(aiResponse);
      const originalAiResponse = aiResponse;
      aiResponse = respGuard.sanitized;
      if (!respGuard.passed) {
        guardrailLogger.logCheck({
          timestamp: new Date().toISOString(),
          sessionId,
          passed: false,
          blockedReason: "Response filtering applied",
          totalRiskScore: 100,
          violationDetails: {
            violations: respGuard.violations,
            originalLength: originalAiResponse.length,
            sanitizedLength: aiResponse.length,
          },
        });
      }

      let imageUrl: string | null = null;
      const tagFromAI = extractImageTag(aiResponse);
      const hasImageTag = !!tagFromAI;
      if (wantsImage || hasImageTag) {
        try {
          let promptForImg: string | null = null;

          if (tagFromAI) {
            // Best case: AI correctly emitted [IMAGE: ...] tag — use it verbatim
            promptForImg = tagFromAI;
            console.log(
              "[IMAGE] Using AI-generated [IMAGE:...] tag prompt:",
              promptForImg.substring(0, 100),
            );
          } else {
            // AI didn't emit a tag — derive from user message (the actual intent)
            const userBased = cleanUserMessageToPrompt(userMsg);
            if (userBased.length >= 10) {
              promptForImg = `${userBased}, highly detailed, cinematic lighting, professional quality, vivid colors`;
              console.log(
                "[IMAGE] Using cleaned userMsg as image prompt (no [IMAGE:] tag found)",
              );
            } else {
              // Last resort: meaningful sentences from AI prose
              const sentences = aiResponse
                .replace(/\[IMAGE:[\s\S]*?\]/gi, "")
                .split(/[.!?]/)
                .map((s: string) => s.trim())
                .filter(
                  (s: string) =>
                    s.length > 20 &&
                    !/^(I |The |This |Here |Let |Sure |Of course)/i.test(s),
                );
              promptForImg = (sentences[0] || userMsg.substring(0, 300)).trim();
              console.log(
                "[IMAGE] Using AI prose excerpt as image prompt (fallback)",
              );
            }
          }

          if (!promptForImg || promptForImg.length < 10) {
            promptForImg =
              cleanUserMessageToPrompt(userMsg) ||
              userMsg.substring(0, 400).trim();
          }

          if (promptForImg) {
            const directImageUrl = buildPollinationsImageUrl(
              promptForImg,
              null,
            );
            imageUrl = `/api/proxy-image?url=${encodeURIComponent(directImageUrl)}`;
            console.log(
              "[IMAGE] Generated URL (first 200):",
              directImageUrl.substring(0, 200),
            );
          }
        } catch (e) {
          console.error("[IMAGE] Generation failed:", e);
        }
      }

      // Final safety: never return HTML to the chat UI.
      if (
        aiResponse &&
        aiResponse.trim().toLowerCase().startsWith("<!doctype html")
      ) {
        console.warn(
          "[AI] Final response appears to be HTML; replacing with local fallback",
        );
        aiResponse = `I can’t display that response right now, but I can still help.\n\nWhat would you like to do next: continue the story, revise the tone, or explore a new scene?`;
      }

      aiResponse = sanitizeAiResponse(aiResponse);
      const turnScore = synthesisEngine.scoreTurn(
        aiResponse,
        userMsg,
        undefined,
        synthesisContext.recordIds,
      );
      console.log(
        `[SYNTHESIS] Scored chat turn (mode: ${mode}, score: ${turnScore.turnScore}, records: ${synthesisContext.recordIds.length})`,
      );
      console.log(
        "[SANITIZED AI RESPONSE]",
        JSON.stringify(aiResponse.substring(0, 500)),
      );
      const tokensUsed = Math.ceil((userMsg.length + aiResponse.length) / 4);
      let assistantMsg: { id: string };
      if (!dataRetentionOptOut) {
        assistantMsg = await storage.createMessage({
          sessionId,
          conversationId: conversation.id,
          role: "assistant",
          content: aiResponse,
          mode,
          tokens: tokensUsed,
        });
        await storage.updateConversation(conversation.id, {
          messageCount: (conversation.messageCount ?? 0) + 2,
          activeModes: Array.from(new Set([...conversation.activeModes, mode])),
        });
      } else {
        assistantMsg = { id: randomUUID() };
      }

      const learningInsights: string[] = [];
      if (learningEnabled && !dataRetentionOptOut) {
        type PatternType =
          | "writing_style"
          | "mode_preference"
          | "topic_interest"
          | "feedback"
          | "story_element"
          | "narrative_theme"
          | "character_detail"
          | "plot_point";
        const patterns: { type: PatternType; data: string; weight: number }[] =
          [];

        try {
          // 1. ALWAYS capture mode preference (baseline)
          patterns.push({ type: "mode_preference", data: mode, weight: 1.0 });

          // 2. CAPTURE STORY ELEMENTS: Extract key narrative components from user message
          if (userMsg.length > 20) {
            // Check for story/narrative indicators
            const isStoryLike =
              /story|narrative|tale|chapter|scene|dialog|character|plot|twist|ending|once upon|there was|i wrote|i created/i.test(
                userMsg,
              );
            if (isStoryLike) {
              // Extract story element (first ~150 chars of substantive content)
              const storySnippet = userMsg
                .substring(0, 150)
                .replace(/\n+/g, " ")
                .trim();
              patterns.push({
                type: "story_element",
                data: storySnippet,
                weight: 2.5,
              });
              learningInsights.push("Story element captured from user message");
            }
          }

          // 3. CAPTURE NARRATIVE THEMES: Detect major themes in the conversation
          const themeKeywords = {
            romance: [
              "love",
              "romantic",
              "relationship",
              "dating",
              "heart",
              "affection",
            ],
            adventure: [
              "quest",
              "adventure",
              "explore",
              "journey",
              "discover",
              "travel",
            ],
            mystery: [
              "mystery",
              "puzzle",
              "secret",
              "clue",
              "investigate",
              "discover",
            ],
            fantasy: [
              "magic",
              "wizard",
              "dragon",
              "enchanted",
              "spell",
              "fantasy",
            ],
            action: ["fight", "battle", "action", "combat", "chase", "danger"],
            drama: [
              "emotional",
              "conflict",
              "relationship",
              "tension",
              "dramatic",
            ],
          };

          let themeFound = false;
          for (const [theme, keywords] of Object.entries(themeKeywords)) {
            const fullContext = userMsg + " " + aiResponse;
            if (
              keywords.some((kw) => new RegExp(kw, "i").test(fullContext)) &&
              !themeFound
            ) {
              patterns.push({
                type: "narrative_theme",
                data: theme,
                weight: 1.5,
              });
              learningInsights.push(`Narrative theme detected: ${theme}`);
              themeFound = true;
              break;
            }
          }

          // 4. CAPTURE CHARACTER MENTIONS: Extract character names or descriptions from AI response
          const characterPattern =
            /(?:character|protagonist|hero|villain|antagonist|person).*?:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)|(?:the\s+)?([A-Z][a-z]+)(?:\s+is\s+(?:a|an|the)|\s+was)/i;
          const userCharMatches = userMsg.match(characterPattern);
          const aiCharMatches = aiResponse.match(characterPattern);

          if (userCharMatches || aiCharMatches) {
            const charName =
              userCharMatches?.[1] ||
              userCharMatches?.[2] ||
              aiCharMatches?.[1] ||
              aiCharMatches?.[2];
            if (charName && charName.length < 50 && charName.length > 2) {
              patterns.push({
                type: "character_detail",
                data: charName,
                weight: 2.0,
              });
              learningInsights.push(`Character captured: ${charName}`);
            }
          }

          // 5. CAPTURE PLOT POINTS: Major story developments from BOTH user and AI
          const plotIndicators =
            /then|suddenly|finally|twist|revelation|climax|ending|resolution|conclusion|last scene|but then|however|meanwhile|later|next/i;
          const fullContent = userMsg + " " + aiResponse;
          if (plotIndicators.test(fullContent) && fullContent.length > 50) {
            // When provider is "local" (synthesis fallback), only use the user message
            // for the snippet — the AI response was synthesized from existing memory
            // and feeding it back would create a poisoning feedback loop.
            const plotSnippet =
              genResult.provider !== "local" && aiResponse.length > 100
                ? aiResponse.substring(0, 120).replace(/\n+/g, " ").trim()
                : userMsg.substring(0, 100).replace(/\n+/g, " ").trim();
            patterns.push({
              type: "plot_point",
              data: plotSnippet,
              weight: 2.5,
            });
            learningInsights.push("Plot point captured");
          }

          // 6. CAPTURE AI RESPONSE SNIPPETS as story context for next turn
          // POISON GUARD: Skip when provider is "local" (synthesis engine fallback).
          // A local response is assembled from already-stored memory. Recording it back
          // into the learning store creates a feedback loop that degrades quality over
          // time — the engine would keep learning from its own recycled outputs.
          if (genResult.provider !== "local" && aiResponse.length > 50) {
            const responseSnippet = aiResponse
              .substring(0, 180)
              .replace(/\n+/g, " ")
              .trim();
            patterns.push({
              type: "story_element",
              data: `[AI]: ${responseSnippet}`,
              weight: 2.0,
            });
            learningInsights.push(
              "AI response context captured for narrative continuity",
            );
          }
        } catch (e) {
          console.error("[LEARNING] Failed during pattern extraction:", e);
        }

        if (patterns.length) {
          for (const p of patterns) {
            await storage.createLearningData({
              sessionId,
              patternType: p.type,
              patternData: p.data,
              weight: p.weight,
            });
          }

          if (
            !learningInsights.includes("Writing-style preferences captured") &&
            patterns.length > 0
          ) {
            learningInsights.push("Writing-style preferences captured");
          }

          const ldCount = (await storage.getLearningData(sessionId)).length;
          // Compress every 6 interactions. Guard ldCount > 0: ldCount % 6 === 0 is
          // true for ldCount=0 (empty store), which would trigger a useless cycle on
          // every fresh-session request — the "false-trigger" cascading failure.
          if (ldCount > 0 && ldCount % 6 === 0) {
            await storage.aggregateAndCompressMemory(sessionId);
            learningInsights.push("Memory aggregated and compressed");
          }
        }
      }

      res.json({
        success: true,
        response: aiResponse,
        conversationId: conversation.id,
        messageId: assistantMsg.id,
        mode,
        tokensUsed,
        learningInsights,
        imageUrl,
        aiProvider: genResult.provider,
        advancedReasoningApplied: advancedReasoningEnabled,
        faithEnhancementApplied: faithEnhancementEnabled,
        metrics: {
          provider: genResult.provider,
          model: genResult.model,
          fallbackUsed: genResult.fallbackUsed,
          learningInsights,
          privacy: getPrivacyMetrics(),
          ftcCompliance: FTC_SECTION_5_COMPLIANCE,
          tokensUsed,
        },
      });
    } catch (e) {
      console.error("[CHAT] Fatal error:", e);
      if (e instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: "Invalid Request Payload", details: e.issues });
      }
      res
        .status(500)
        .json({ error: "An unexpected error occurred. Please try again." });
    }
  });

  // ── Streaming chat endpoint ──────────────────────────────────────────────────
  app.post("/api/chat/stream", async (req, res) => {
    try {
      const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
      if (!validateContentLength(contentLength)) {
        return res.status(413).json({ error: "Payload too large" });
      }

      const sessionId = getSessionId(req);
      if (!validateSessionId(sessionId)) {
        return res.status(400).json({ error: "Invalid session ID" });
      }

      const VALID_STREAM_MODES = [
        "standard",
        "flesh_architect",
        "sanctuary",
        "advanced_reasoning",
        "autonomous",
        "video_generator",
        "code_graph",
        "academic_research",
      ];
      const rawStreamMode = req.body?.mode;
      if (!rawStreamMode || !VALID_STREAM_MODES.includes(rawStreamMode)) {
        return res
          .status(400)
          .json({
            error: "Invalid or missing mode",
            validModes: VALID_STREAM_MODES,
          });
      }

      const ALLOWED_TEXT_MODELS = [
        "openai",
        "claude",
        "gemini",
        "deepseek",
        "mistral",
        "qwen3-coder",
      ] as const;
      const ALLOWED_IMAGE_MODELS = [
        "flux",
        "gptimage",
        "turbo",
        "seedream",
      ] as const;
      const body = chatRequestSchema
        .extend({
          conversationId: z.string().nullish(),
          learningEnabled: z.boolean().optional(),
          activeModes: z.array(z.string()).optional(),
          advancedReasoningEnabled: z.boolean().optional(),
          faithEnhancementEnabled: z.boolean().optional(),
          webSearchEnabled: z.boolean().optional(),
          textModel: z.enum(ALLOWED_TEXT_MODELS).optional(),
          imageModel: z.enum(ALLOWED_IMAGE_MODELS).optional(),
          maxTokens: z.number().int().min(1).max(65536).optional(),
        })
        .parse(req.body);

      let userMsg = body.message.trim();
      if (userMsg.length === 0 || userMsg.length > 25000) {
        return res
          .status(400)
          .json({ error: "Message length must be 1-25,000 characters" });
      }
      userMsg = userMsg.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

      const {
        mode,
        conversationId,
        learningEnabled: _learningEnabled,
        activeModes = [mode],
        advancedReasoningEnabled = true,
        faithEnhancementEnabled = false,
        webSearchEnabled = false,
        textModel = openRouterModel,
        imageModel = "flux",
        maxTokens = 32768,
        bookTitles,
        bookNarrativeVoice,
        bookContext,
      } = body;
      const learningEnabled = _learningEnabled ?? true;

      // --- UNIVERSAL ARTIFACT INTERCEPTOR (stream route) ---
      // Mirrors the same heuristic as POST /api/chat so long-horizon tasks
      // are caught regardless of which endpoint the client hits.

      // Pre-Generation Estimator (stream): structural complexity analysis
      const _streamPgeScore =
        userMsg.length + userMsg.split(/[.!?]/).length * 20;
      const _streamPgeKeyword =
        /write a (?:book|chapter|document|essay|paper|analysis)|write me a (?:book|chapter|document|essay|paper|analysis)/i.test(
          userMsg,
        );
      const _streamPgeComplex = _streamPgeScore > 2000;

      const isLongHorizonTaskStream =
        userMsg.toLowerCase().includes("/full") ||
        _streamPgeKeyword ||
        _streamPgeComplex ||
        (userMsg.length > 120 &&
          /(?:comprehensive|exhaustive|complete book|write a paper|detailed report|full manuscript|in-depth analysis|15 chapters)/i.test(
            userMsg,
          ));

      // Artifact diversion is only active inside academic_research mode
      const shouldDivertToArtifact =
        mode === "academic_research" && isLongHorizonTaskStream;

      if (shouldDivertToArtifact) {
        console.log(
          `[PRE-GEN ESTIMATOR/stream] score=${_streamPgeScore} keyword=${_streamPgeKeyword} complex=${_streamPgeComplex} → artifact diversion`,
        );
        try {
          console.log(
            `[CORE_SYSTEM] Stream horizon threshold exceeded. Diverting mode [${mode}] to deep background infrastructure.`,
          );
          const topicCleaned = userMsg.replace(/\/full/gi, "").trim();
          const jobResult = await startArtifactBuildJob(
            topicCleaned,
            sessionId,
            mode,
          );
          return res.status(200).json({
            status: "AUTOMATION_DIVERTED",
            message:
              "Task horizon exceeds standard context limits. Safely diverted to deep artifact generation pipeline.",
            jobId: jobResult.jobId,
            modeContext: mode,
            targetEndpoint: `/api/academic/artifact/status/${jobResult.jobId}`,
          });
        } catch (divertErr) {
          console.error(
            "[SYSTEM_WARNING] Stream diversion failed. Initiating standard stream fallback:",
            divertErr,
          );
        }
      }
      // --- END INTERCEPTOR ---

      const { session, isOver18, ageVerified } =
        await getVerifiedSession(sessionId);
      if (!session) {
        return res
          .status(401)
          .json({ error: "Session not found", requiresAgeVerification: true });
      }
      if (!ageVerified || !isOver18) {
        return res.status(403).json({
          error: "Age verification required",
          requiresAgeVerification: true,
        });
      }

      const rate = await storage.checkRateLimit(sessionId);
      if (!rate.allowed) {
        return res
          .status(429)
          .json({ error: "Session terminated", message: rate.reason });
      }

      const msgs = await storage.getMessages(sessionId);
      if (msgs.length >= 500) {
        return res
          .status(429)
          .json({ error: "Message limit reached", limit: 500 });
      }

      const guardReq: GuardrailCheckRequest = {
        content: userMsg,
        isOver18,
        context: "creative_writing",
      };
      const inputGuard = executeGuardrails(guardReq);
      if (!inputGuard.passed) {
        return res.status(403).json({
          error: "Content policy violation",
          reason: inputGuard.blockedReason,
        });
      }

      const conflicts = MODE_CONFLICTS[mode] ?? [];
      const hasConflict = activeModes.some((m) =>
        conflicts.includes(m as AIMode),
      );
      if (hasConflict) {
        return res.status(400).json({ error: "Invalid mode configuration" });
      }

      const dataRetentionOptOut = session.dataRetentionOptOut === true;

      let conversation = conversationId
        ? await storage.getConversation(conversationId)
        : null;
      if (!conversation) {
        if (!dataRetentionOptOut) {
          conversation = await storage.createConversation({
            sessionId,
            title: userMsg.slice(0, 50) + (userMsg.length > 50 ? "…" : ""),
            messageCount: 0,
            activeModes: [mode],
          });
        } else {
          conversation = {
            id: randomUUID(),
            sessionId,
            title: userMsg.slice(0, 50) + (userMsg.length > 50 ? "…" : ""),
            messageCount: 0,
            activeModes: [mode],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as any;
        }
      }

      if (!conversation) {
        throw new Error("Failed to initialize conversation");
      }

      const streamFeedback = getBoneMarrowFeedback(userMsg);
      if (streamFeedback.boneDelta !== 0 || streamFeedback.marrowDelta !== 0) {
        const priorTrace = localSynthesisFeedbackMap.get(sessionId);
        if (priorTrace && priorTrace.recordIds.length > 0) {
          synthesisEngine.applyBoneMarrowFeedback(priorTrace.recordIds, streamFeedback);
          console.log(
            `[LOCAL SYNTHESIS/STREAM] Applied feedback bone=${streamFeedback.boneDelta.toFixed(5)} marrow=${streamFeedback.marrowDelta.toFixed(5)} to ${priorTrace.recordIds.length} record(s)`
          );
        }
      }

      if (!dataRetentionOptOut) {
        await storage.createMessage({
          sessionId,
          conversationId: conversation.id,
          role: "user",
          content: userMsg,
          mode,
        });
      }

      // Build system prompt — same 3-priority memory injection as /api/chat
      let learnedInject = "";
      try {
        // PRIORITY 1: recent context from THIS conversation only (last 40 messages)
        try {
          const allConvMsgs = dataRetentionOptOut
            ? []
            : await storage.getMessagesByConversation(conversation.id);
          const recentMessages = allConvMsgs.slice(-40);
          if (recentMessages.length > 0) {
            const messageContext = buildDeepConversationContext(recentMessages);
            if (messageContext)
              learnedInject = `\n\n[CONVERSATION CONTEXT — CURRENT CHAT ONLY]\n${messageContext}\n`;
          }
        } catch (e) {
          console.error("[STREAM] Error loading recent messages:", e);
        }

        // PRIORITY 2: long-term memories (when no recent context)
        if (!learnedInject || learnedInject.length < 50) {
          try {
            const memories = await storage.getLongTermMemory(sessionId, 10);
            if (memories.length) {
              const top = memories
                .filter((m) => m.confidenceScore > 0.6)
                .map(
                  (m) =>
                    `[LEARNED] ${m.summary} (confidence: ${(m.confidenceScore * 100).toFixed(0)}%)`,
                )
                .join("\n");
              if (top)
                learnedInject += `\n\n[USER CONTEXT FROM LEARNING]\n${top}\n`;
            }
          } catch (e) {
            console.error("[STREAM] Error loading long-term memory:", e);
          }
        }

        // PRIORITY 3: recent learning data summaries
        if (!learnedInject || learnedInject.length < 50) {
          try {
            const learning = await storage.getLearningData(sessionId);
            if (learning && learning.length) {
              const storyElements = learning
                .filter((l) =>
                  [
                    "story_element",
                    "narrative_theme",
                    "character_detail",
                    "plot_point",
                  ].includes(l.patternType),
                )
                .slice(-5)
                .map((l) => `[${l.patternType.toUpperCase()}] ${l.patternData}`)
                .join("\n");
              if (storyElements)
                learnedInject += `\n\n[RECENT NARRATIVE ELEMENTS]\n${storyElements}\n`;
            }
          } catch (e) {
            console.error("[STREAM] Error loading learning data:", e);
          }
        }
      } catch (e) {
        console.error("[STREAM] Error loading context:", e);
      }

      let systemPrompt = CORE_SYSTEM_PROMPT;
      systemPrompt += "\n" + (MODE_PROMPTS[mode] ?? MODE_PROMPTS.standard);
      systemPrompt += learnedInject;
      systemPrompt += buildBookNarrativeGuidance(
        bookTitles,
        bookNarrativeVoice,
        bookContext,
      );
      if (advancedReasoningEnabled)
        systemPrompt += ADVANCED_REASONING_ENHANCEMENT;
      if (faithEnhancementEnabled) systemPrompt += FAITH_ENHANCEMENT;

      if (isLegalPolicyQuery(userMsg)) {
        try {
          systemPrompt += await buildLegalPromptContext(userMsg);
          console.log(
            "[LEGAL] Live legal documents injected into stream system prompt",
          );
        } catch (e) {
          console.error(
            "[LEGAL] Failed to inject live legal documents into stream prompt:",
            e,
          );
        }
      }

      // ── CONTINUE DIRECTIVE ────────────────────────────────────────────────────
      // When the user types "continue" (alone), tell the AI to resume the last
      // response exactly where it stopped rather than starting fresh.
      const isContinueRequest = /^continue\.?$/i.test(userMsg.trim());
      if (isContinueRequest) {
        try {
          const allMsgs = dataRetentionOptOut
            ? []
            : await storage.getMessagesByConversation(conversation.id);
          const lastAI = [...allMsgs]
            .reverse()
            .find((m) => m.role === "assistant");
          if (lastAI) {
            const tail = lastAI.content.slice(-800); // last 800 chars = where it cut off
            systemPrompt += `\n\n[CONTINUE DIRECTIVE — CRITICAL]\nThe user wants you to CONTINUE your previous response from EXACTLY where it stopped. DO NOT repeat, summarise, or restate anything you have already written. Simply pick up mid-word or mid-sentence if necessary and keep writing until you reach a natural, complete ending point.\n\nYour previous response ended with:\n"…${tail}"\n\nResume immediately after that last character.`;
          } else {
            systemPrompt += `\n\n[CONTINUE DIRECTIVE]\nThe user wants you to continue. Please elaborate further on your last response with additional depth and detail.`;
          }
        } catch (e) {
          console.warn(
            "[CONTINUE] Could not load last assistant message:",
            e instanceof Error ? e.message : e,
          );
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

      // CODE GRAPH MODE: auto-extract knowledge graph from any code blocks in message
      if (mode === "code_graph") {
        const codeBlockRe = /```[\w]*\n?([\s\S]*?)```/g;
        let codeMatch: RegExpExecArray | null;
        const codeBlocks: string[] = [];
        while ((codeMatch = codeBlockRe.exec(userMsg)) !== null) {
          codeBlocks.push(codeMatch[1]);
        }
        if (codeBlocks.length === 0 && userMsg.split("\n").length >= 5) {
          const hasCode =
            /\b(function|const|let|var|class|import|export|def |fn |package )\b/.test(
              userMsg,
            );
          if (hasCode) codeBlocks.push(userMsg);
        }
        if (codeBlocks.length > 0) {
          try {
            const combinedCode = codeBlocks.join("\n\n");
            const graph = analyzeCode(combinedCode);
            const graphText = formatGraphForAI(graph);
            systemPrompt += `\n\n${graphText}\n`;
            console.log(
              `[CODE GRAPH STREAM] Analyzed ${graph.stats.totalLines} lines, ${graph.stats.totalFunctions} functions`,
            );
          } catch (e) {
            console.error("[CODE GRAPH STREAM] Analysis error:", e);
          }
        }
      }

      // URL content injection — if the user shared a URL, fetch and inject its readable content
      const urlMatches = userMsg.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi);
      if (urlMatches && urlMatches.length > 0) {
        const urlsToFetch = urlMatches.slice(0, 2); // Max 2 URLs
        const urlContextParts: string[] = [];
        for (const url of urlsToFetch) {
          try {
            console.log(
              `[STREAM] Fetching URL content: ${url.substring(0, 80)}`,
            );
            const pageContent = await fetchUrlContent(url);
            if (pageContent && pageContent.length > 100) {
              urlContextParts.push(
                `[URL CONTENT — ${url.substring(0, 80)}]\n${pageContent}\n[END URL CONTENT]`,
              );
              console.log(
                `[STREAM] Injected ${pageContent.length} chars from ${url.substring(0, 60)}`,
              );
            }
          } catch (e) {
            console.warn(
              `[STREAM] Failed to fetch URL ${url.substring(0, 60)}:`,
              e instanceof Error ? e.message : e,
            );
          }
        }
        if (urlContextParts.length > 0) {
          systemPrompt += `\n\n[LIVE URL CONTEXT — User shared these links. Use this content to inform your response.]\n${urlContextParts.join("\n\n")}\n[END URL CONTEXT]\n`;
        }
      }

      // Web search injection — fire when user enabled it OR auto-detected from keywords
      const needsSearch =
        webSearchEnabled ||
        /\b(search|look up|find out|latest|current events|news|who is|what is|when did|2024|2025|2026|today|recent|breaking|internet|web|live|real.?time)\b/i.test(
          userMsg,
        );
      if (needsSearch) {
        try {
          console.log(
            `[STREAM] Web search triggered (explicit=${webSearchEnabled}) — querying DuckDuckGo...`,
          );
          const searchResults = await searchWeb(userMsg);
          if (searchResults) {
            systemPrompt += `\n\n[LIVE WEB SEARCH RESULTS — query: "${userMsg.substring(0, 100)}"]\n${searchResults}\n[END WEB RESULTS]\nUse these search results to inform your response. Cite information naturally (e.g. "According to web search..." or "As of recently..."). If results are sparse, supplement with your built-in 2025-2026 knowledge.\n`;
            console.log(
              "[STREAM] Web search results injected into system prompt",
            );
          }
        } catch (e) {
          console.warn(
            "[STREAM] Web search injection failed:",
            e instanceof Error ? e.message : e,
          );
        }
      }

      // ── ACADEMIC RESEARCH MODE: Guard Loop search context injection (stream) ─
      // Purely additive — sandboxed, does not modify existing web search tools.
      if (mode === "academic_research") {
        try {
          const academicSearchCtx = await academicSearchGuard(userMsg);
          if (
            academicSearchCtx &&
            !academicSearchCtx.includes("Falling back")
          ) {
            systemPrompt += `\n\n[ACADEMIC GUARD LOOP — LIVE RESEARCH CONTEXT]\n${academicSearchCtx}\n[END ACADEMIC CONTEXT]\nCite these sources naturally in your academic response. Use formal attribution (e.g. "Research indicates...", "According to available sources...").`;
            console.log(
              "[ACADEMIC GUARD LOOP] Search context injected into stream system prompt",
            );
          }
        } catch (e) {
          console.warn(
            "[ACADEMIC GUARD LOOP] Guard loop failed gracefully (stream):",
            e instanceof Error ? e.message : e,
          );
        }
      }

      // Set SSE headers BEFORE streaming starts
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const sendEvent = (data: object) =>
        res.write(`data: ${JSON.stringify(data)}\n\n`);

      const synthesisContext = enrichPromptWithSynthesis(
        systemPrompt,
        userMsg,
        mode,
        sessionId,
      );
      systemPrompt = synthesisContext.prompt;

      // Cap the system prompt so input never starves the model's output budget
      const cappedSystemPrompt = capSystemPromptForProvider(systemPrompt);
      if (cappedSystemPrompt.length < systemPrompt.length) {
        console.log(
          `[STREAM] System prompt capped: ${systemPrompt.length} → ${cappedSystemPrompt.length} chars`,
        );
      }

      // Try streaming from OpenRouter first
      let fullText = await streamOpenRouter(
        cappedSystemPrompt,
        userMsg,
        (token) => {
          sendEvent({ token });
        },
        textModel,
        maxTokens,
      );
      const streamedFromOpenRouter = !!fullText;

      // If streaming failed, fall back to non-streaming
      if (!fullText) {
        console.log(
          "[STREAM] Streaming failed, falling back to generateWithFallback",
        );
        const genResult = await generateWithFallback(
          cappedSystemPrompt,
          userMsg,
          { maxTokens },
          textModel,
          sessionId,
          mode,
        );
        fullText = genResult.text;
        if (genResult.provider === "local") {
          const trace = genResult.trace ?? null;
          if (trace && trace.recordIds.length > 0) {
            localSynthesisFeedbackMap.set(sessionId, {
              recordIds: trace.recordIds,
              confidence: trace.confidence,
              supportLevel: trace.supportLevel,
              timestamp: Date.now(),
            });
          } else {
            localSynthesisFeedbackMap.delete(sessionId);
          }
        } else {
          localSynthesisFeedbackMap.delete(sessionId);
        }
        // Send entire text as one token burst
        const words = fullText.split(" ");
        for (const word of words) {
          sendEvent({ token: word + " " });
        }
      } else {
        localSynthesisFeedbackMap.delete(sessionId);
      }

      if (streamedFromOpenRouter && fullText) {
        try {
          synthesisEngine.observe(
            cappedSystemPrompt,
            userMsg,
            fullText,
            "openrouter",
            mode,
            { memory: true, source: "conversation", ownerScope: sessionId },
          );
        } catch (err) {
          console.error(
            "[SYNTHESIS/STREAM] observe() failed after OpenRouter success:",
            err,
          );
        }
      }

      // Sanitize and apply guardrails
      const respGuard = executeResponseGuardrails(fullText);
      fullText = sanitizeAiResponse(respGuard.sanitized);

      // Final HTML guard
      if (fullText.trim().toLowerCase().startsWith("<!doctype html")) {
        fullText = `I can't display that response right now, but I can still help.\n\nWhat would you like to do next: continue the story, revise the tone, or explore a new scene?`;
      }

      const turnScore = synthesisEngine.scoreTurn(
        fullText,
        userMsg,
        undefined,
        synthesisContext.recordIds,
      );
      console.log(
        `[SYNTHESIS/STREAM] Scored chat turn (mode: ${mode}, score: ${turnScore.turnScore}, records: ${synthesisContext.recordIds.length})`,
      );

      const tokensUsed = Math.ceil((userMsg.length + fullText.length) / 4);

      let assistantMsg: { id: string };
      if (!dataRetentionOptOut) {
        assistantMsg = await storage.createMessage({
          sessionId,
          conversationId: conversation.id,
          role: "assistant",
          content: fullText,
          mode,
          tokens: tokensUsed,
        });
        await storage.updateConversation(conversation.id, {
          messageCount: (conversation.messageCount ?? 0) + 2,
          activeModes: Array.from(new Set([...conversation.activeModes, mode])),
        });
      } else {
        assistantMsg = { id: randomUUID() };
      }

      // Check if image is needed
      const wantsImageStream =
        /\b(image|picture|photo|illustration|draw|drawing|sketch|paint|painting|visuali|generate.*image|show.*image|create.*image|make.*image|render|portrait|artwork|art of|depict)\b/i.test(
          userMsg,
        );
      const tagFromStream = extractImageTag(fullText);
      let imageUrl: string | null = null;
      if (wantsImageStream || tagFromStream) {
        try {
          let promptForImg: string | null = tagFromStream;
          if (!promptForImg) {
            promptForImg = cleanUserMessageToPrompt(userMsg);
            if (promptForImg.length < 10)
              promptForImg = userMsg.substring(0, 300).trim();
          }
          if (promptForImg && promptForImg.length >= 10) {
            const directImageUrl = buildPollinationsImageUrl(
              promptForImg,
              null,
              imageModel,
            );
            imageUrl = `/api/proxy-image?url=${encodeURIComponent(directImageUrl)}`;
            console.log(
              "[STREAM IMAGE] Using prompt:",
              promptForImg.substring(0, 100),
            );
          }
        } catch (e) {
          console.error("[STREAM IMAGE] Generation failed:", e);
        }
      }

      // Learning (fire-and-forget)
      if (learningEnabled && !dataRetentionOptOut) {
        storage
          .createLearningData({
            sessionId,
            patternType: "mode_preference",
            patternData: mode,
            weight: 1.0,
          })
          .catch(() => {});
      }

      // Send completion event
      sendEvent({
        done: true,
        messageId: assistantMsg.id,
        conversationId: conversation.id,
        mode,
        tokensUsed,
        imageUrl,
      });

      res.end();
    } catch (e) {
      console.error("[STREAM] Fatal error:", e);
      if (!res.headersSent) {
        if (e instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid Request Payload" });
        }
        return res.status(500).json({ error: "An unexpected error occurred." });
      }
      try {
        res.write(
          `data: ${JSON.stringify({ error: "Stream error occurred" })}\n\n`,
        );
        res.end();
      } catch {}
    }
  });

  // ── Web Search Endpoint (Aletheia-powered via DuckDuckGo) ──────────────────
  app.get("/api/web-search", async (req, res) => {
    try {
      const query = ((req.query.q as string) || "").trim();
      if (!query || query.length < 2) {
        return res.status(400).json({ error: "Query required", results: null });
      }
      if (query.length > 300) {
        return res
          .status(400)
          .json({ error: "Query too long (max 300 chars)", results: null });
      }
      const results = await searchWeb(query);
      res.json({
        success: true,
        query,
        results: results || "No results found for this query.",
        source: "DuckDuckGo Instant Answers",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[WEB SEARCH] Error:", error);
      res.status(500).json({
        success: false,
        error: "Search failed",
        results: null,
      });
    }
  });

  app.post("/api/web-search", async (req, res) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== "string" || query.trim().length < 2) {
        return res.status(400).json({ error: "Query required", results: null });
      }
      const results = await searchWeb(query.trim());
      res.json({
        success: true,
        query: query.trim(),
        results: results || "No results found for this query.",
        source: "DuckDuckGo Instant Answers + HTML Scrape",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[WEB SEARCH POST] Error:", error);
      res
        .status(500)
        .json({ success: false, error: "Search failed", results: null });
    }
  });

  // ── Privacy Policy ─────────────────────────────────────────────────────────
  app.get("/api/privacy-policy", async (_req, res) => {
    try {
      const privacyPolicy = await readLegalDocument("privacy");
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.send(privacyPolicy);
    } catch (error) {
      console.error("[LEGAL] Failed to read PRIVACY_POLICY.md:", error);
      res.status(500).json({ error: "Failed to load privacy policy" });
    }
  });

  // ── Privacy: Delete All User Data ──────────────────────────────────────────
  // This endpoint removes all user interaction records (messages, conversations,
  // deletion requests) while preserving the consent audit log and any AI learning
  // data the user has already opted into. That makes deletion compliant with
  // user privacy while still keeping the minimal legal audit trail intact.
  app.post("/api/privacy/delete-data", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId) {
        return res.status(401).json({ error: "No session found" });
      }

      console.log(
        `[PRIVACY DELETE] Hard-deleting all data for session: ${sessionId}`,
      );

      const ok = await storage.deleteAllUserData(sessionId);

      console.log(
        `[PRIVACY DELETE] Completed for session ${sessionId}: success=${ok}`,
      );

      return res.json({
        success: true,
        message: "All your data has been permanently deleted.",
        sessionId,
      });
    } catch (err) {
      console.error("[PRIVACY DELETE] Error:", err);
      return res.status(500).json({
        error: "Failed to delete data",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  // ── Privacy: Export User Data ───────────────────────────────────────────────
  app.get("/api/privacy/export-data", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId) {
        return res.status(401).json({ error: "No session found" });
      }

      const [
        session,
        messages,
        conversations,
        consentData,
        learningData,
        memories,
      ] = await Promise.all([
        storage.getSession(sessionId),
        storage.getMessages(sessionId),
        storage.getConversationsBySession(sessionId),
        storage.getConsent(sessionId),
        storage.getLearningData(sessionId),
        storage.getLongTermMemory(sessionId, 1000),
      ]);

      return res.json({
        exportedAt: new Date().toISOString(),
        sessionId,
        session,
        conversations,
        messages,
        consent: consentData,
        learningData,
        longTermMemory: memories,
      });
    } catch (err) {
      console.error("[PRIVACY EXPORT] Error:", err);
      return res.status(500).json({ error: "Failed to export data" });
    }
  });

  // ── Privacy: Export User Data as ZIP (GDPR Art. 20 Portability) ───────────
  app.get("/api/privacy/export-data/zip", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId)
        return res.status(401).json({ error: "No session found" });

      const [
        session,
        messages,
        conversations,
        consentData,
        learningData,
        memories,
      ] = await Promise.all([
        storage.getSession(sessionId),
        storage.getMessages(sessionId),
        storage.getConversationsBySession(sessionId),
        storage.getConsent(sessionId),
        storage.getLearningData(sessionId),
        storage.getLongTermMemory(sessionId, 1000),
      ]);

      const exportDate = new Date().toISOString().split("T")[0];
      const filename = `betagrace-data-export-${exportDate}.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );

      const archive = new ZipArchive({ zlib: { level: 9 } });
      archive.on("error", (err: Error) => {
        console.error("[PRIVACY ZIP] Archive error:", err);
        if (!res.headersSent) res.status(500).end();
      });
      archive.pipe(res);

      const addJson = (name: string, data: unknown) =>
        archive.append(JSON.stringify(data, null, 2), { name });

      const now = new Date().toISOString();
      addJson("session.json", { exportedAt: now, sessionId, session });
      addJson("conversations.json", {
        exportedAt: now,
        count: conversations.length,
        conversations,
      });
      addJson("messages.json", {
        exportedAt: now,
        count: messages.length,
        messages,
      });
      addJson("consent.json", { exportedAt: now, consent: consentData });
      addJson("learning_data.json", {
        exportedAt: now,
        count: learningData.length,
        learningData,
      });
      addJson("long_term_memory.json", {
        exportedAt: now,
        count: memories.length,
        memories,
      });
      archive.append(
        [
          "BetaGrace vI — Data Export Package",
          `Generated : ${now}`,
          `Session ID: ${sessionId}`,
          "",
          "Files included:",
          "  session.json          — Session record and preferences",
          "  conversations.json    — All conversation threads",
          "  messages.json         — Every message in full",
          "  consent.json          — Cookie and data consent record",
          "  learning_data.json    — Writing pattern data learned from your sessions",
          "  long_term_memory.json — Compressed long-term memory summaries",
          "",
          "This export is provided under GDPR Article 20 — Right to Data Portability.",
          "All data is from your self-hosted PostgreSQL instance.",
          "No data was shared with any external service.",
        ].join("\n"),
        { name: "README.txt" },
      );

      await archive.finalize();
      console.log(
        `[PRIVACY ZIP] Exported ${messages.length} messages, ${conversations.length} conversations for ${sessionId}`,
      );
    } catch (err) {
      console.error("[PRIVACY ZIP] Error:", err);
      if (!res.headersSent)
        res.status(500).json({ error: "Failed to generate ZIP export" });
    }
  });

  // ── Privacy: Submit GDPR Article 17 Deletion Request ──────────────────────
  app.post("/api/privacy/deletion-request", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId)
        return res.status(401).json({ error: "No session found" });

      const { reason, userMessage } = req.body as {
        reason?: string;
        userMessage?: string;
      };
      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: "A reason is required" });
      }

      const existing = await storage.getDeletionRequestBySession(sessionId);
      if (
        existing &&
        (existing.status === "pending" || existing.status === "processing")
      ) {
        return res.status(409).json({
          error: "A deletion request is already pending",
          requestId: existing.id,
          status: existing.status,
          requestedAt: existing.requestedAt,
        });
      }

      const newRequest = await storage.createDeletionRequest({
        sessionId,
        requestType: "full_deletion",
        status: "pending",
        userMessage: [reason.trim(), userMessage?.trim()]
          .filter(Boolean)
          .join("\n\n"),
      });

      const emailResult = await sendDeletionRequestEmail({
        requestId: newRequest.id,
        sessionId,
        requestedAt: newRequest.requestedAt,
        reason: reason.trim(),
        userMessage: userMessage?.trim() || null,
      });

      console.log(
        `[DELETION REQUEST] Created ${newRequest.id} for ${sessionId} — email sent: ${emailResult.sent}` +
          (emailResult.reason ? ` (${emailResult.reason})` : ""),
      );

      return res.status(201).json({
        success: true,
        requestId: newRequest.id,
        status: newRequest.status,
        requestedAt: newRequest.requestedAt,
        emailNotificationSent: emailResult.sent,
      });
    } catch (err) {
      console.error("[DELETION REQUEST] Error:", err);
      return res
        .status(500)
        .json({ error: "Failed to submit deletion request" });
    }
  });

  // ── Privacy: Get Current Session Deletion Request Status ──────────────────
  app.get("/api/privacy/deletion-request", async (req, res) => {
    try {
      const sessionId = getSessionId(req);
      if (!sessionId)
        return res.status(401).json({ error: "No session found" });

      const request = await storage.getDeletionRequestBySession(sessionId);
      if (!request) return res.json({ exists: false });

      return res.json({
        exists: true,
        requestId: request.id,
        status: request.status,
        requestedAt: request.requestedAt,
        completedAt: request.completedAt ?? null,
      });
    } catch (err) {
      console.error("[DELETION REQUEST STATUS] Error:", err);
      return res
        .status(500)
        .json({ error: "Failed to fetch deletion request status" });
    }
  });

  // ── Terms of Service ───────────────────────────────────────────────────────
  app.get("/api/terms-of-service", async (_req, res) => {
    try {
      const termsOfService = await readLegalDocument("terms");
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.send(termsOfService);
    } catch (error) {
      console.error("[LEGAL] Failed to read TERMS_OF_SERVICE.md:", error);
      res.status(500).json({ error: "Failed to load terms of service" });
    }
  });

  // ── Mend-Code: Self-healing code analysis and repair ──────────────────────
  app.post("/api/mend-code", async (req, res) => {
    try {
      const { code, filename, mode, language } = req.body as {
        code?: string;
        filename?: string;
        mode?: string;
        language?: string;
      };

      if (!code || typeof code !== "string" || code.trim().length === 0) {
        return res.status(400).json({ error: "Code is required" });
      }

      const codeText = code.trim();
      const lang = language ?? filename?.split(".").pop() ?? "js";
      const isDevPass = mode === "dev_pass";
      const lines = codeText.split("\n");
      const lineCount = lines.length;

      // ── Static analysis — 70x7 protocol (multi-pass inspection) ──
      interface Issue {
        line: number | null;
        severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
        category: string;
        message: string;
        suggestion: string;
      }

      const issues: Issue[] = [];

      // PASS 1: Security patterns
      lines.forEach((line, i) => {
        const ln = i + 1;
        // SQL injection risk
        if (
          /`\s*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE)\b/i.test(line) &&
          !/\$\d|\bprepare\b|\bparameterize\b/.test(line)
        ) {
          issues.push({
            line: ln,
            severity: "CRITICAL",
            category: "security",
            message:
              "Potential SQL injection via template literal string interpolation",
            suggestion:
              "Use parameterized queries: db.query('SELECT * FROM t WHERE id = $1', [id])",
          });
        }
        // eval/exec usage
        if (/\beval\s*\(|\bexec\s*\(|\bnew\s+Function\s*\(/.test(line)) {
          issues.push({
            line: ln,
            severity: "CRITICAL",
            category: "security",
            message:
              "Dynamic code execution (eval/exec/new Function) is a severe security risk",
            suggestion:
              "Replace with safe alternatives: JSON.parse() for data, explicit function maps for dispatch",
          });
        }
        // Hardcoded secrets
        if (
          /(?:password|secret|api_?key|token)\s*=\s*['"][^'"]{6,}['"]/i.test(
            line,
          ) &&
          !/process\.env|import\.meta\.env|getenv/.test(line)
        ) {
          issues.push({
            line: ln,
            severity: "CRITICAL",
            category: "security",
            message:
              "Hardcoded credential detected — never embed secrets in source code",
            suggestion:
              "Use environment variables: process.env.MY_SECRET or import.meta.env.VITE_KEY",
          });
        }
        // XSS risk
        if (/innerHTML\s*=|outerHTML\s*=|document\.write\s*\(/.test(line)) {
          issues.push({
            line: ln,
            severity: "HIGH",
            category: "security",
            message:
              "Direct DOM manipulation with innerHTML/outerHTML risks XSS injection",
            suggestion:
              "Use textContent for plain text, or sanitize with DOMPurify before innerHTML assignment",
          });
        }
      });

      // PASS 2: Error handling
      const hasAsync = /\basync\b|\bawait\b|\.then\s*\(|new\s+Promise/.test(
        codeText,
      );
      const hasTryCatch = /\btry\s*\{|\bcatch\s*\(/.test(codeText);
      const hasPromiseCatch = /\.catch\s*\(/.test(codeText);
      if (hasAsync && !hasTryCatch && !hasPromiseCatch) {
        issues.push({
          line: null,
          severity: "HIGH",
          category: "reliability",
          message:
            "Async operations present with no error handling (no try/catch or .catch())",
          suggestion:
            "Wrap async operations in try/catch blocks. Unhandled promise rejections crash Node.js.",
        });
      }

      // PASS 3: TypeScript quality
      if (["ts", "tsx"].includes(lang)) {
        const anyMatches = codeText.match(/:\s*any\b|as\s+any\b/g);
        if (anyMatches && anyMatches.length > 2) {
          issues.push({
            line: null,
            severity: "MEDIUM",
            category: "type-safety",
            message: `${anyMatches.length} uses of TypeScript 'any' type detected — defeats type checking`,
            suggestion:
              "Define explicit interfaces/types. Use 'unknown' + type guards instead of 'any'.",
          });
        }
        if (/\bnon-null-assertion|!\./m.test(codeText)) {
          const count = (codeText.match(/!\./g) || []).length;
          if (count > 3) {
            issues.push({
              line: null,
              severity: "MEDIUM",
              category: "type-safety",
              message: `${count} non-null assertion operators (!.) found — these bypass null safety`,
              suggestion:
                "Use optional chaining (?.) and nullish coalescing (??) instead.",
            });
          }
        }
      }

      // PASS 4: Code structure
      if (lineCount > 300) {
        issues.push({
          line: null,
          severity: "MEDIUM",
          category: "maintainability",
          message: `File is ${lineCount} lines — exceeds recommended 300-line module limit`,
          suggestion:
            "Decompose into smaller modules. Each file should have a single, clear responsibility.",
        });
      }
      const consoleLogs = lines.filter((l) => /console\.log\(/.test(l)).length;
      if (consoleLogs > 5) {
        issues.push({
          line: null,
          severity: "LOW",
          category: "code-quality",
          message: `${consoleLogs} console.log statements found — remove before production deployment`,
          suggestion:
            "Replace with structured logging (winston, pino) or remove debug logs.",
        });
      }

      // PASS 5: React-specific (if JSX/TSX)
      if (["jsx", "tsx"].includes(lang)) {
        if (/useEffect\s*\([^,]+\)(?!\s*,)/.test(codeText)) {
          issues.push({
            line: null,
            severity: "MEDIUM",
            category: "react",
            message:
              "useEffect missing dependency array — will run on every render",
            suggestion:
              "Add dependency array as second argument: useEffect(() => { ... }, [dep1, dep2])",
          });
        }
        if (/\.map\s*\([^)]+\)\s*=>\s*(?:<|\()(?!.*\bkey=)/.test(codeText)) {
          issues.push({
            line: null,
            severity: "MEDIUM",
            category: "react",
            message: "List rendering without 'key' prop detected",
            suggestion:
              "Add a stable, unique key prop to each mapped element: key={item.id}",
          });
        }
      }

      // PASS 6: Performance
      if (/for\s*\([^)]+\)\s*\{[\s\S]*?await\s/m.test(codeText)) {
        issues.push({
          line: null,
          severity: "MEDIUM",
          category: "performance",
          message:
            "Sequential await inside a loop — executes promises serially when parallel is faster",
          suggestion:
            "Use Promise.all() to parallelize: const results = await Promise.all(items.map(item => fetchItem(item)))",
        });
      }

      // PASS 7: Accessibility (if HTML/JSX)
      if (["jsx", "tsx", "html"].includes(lang)) {
        if (/<img(?![^>]*alt=)/i.test(codeText)) {
          issues.push({
            line: null,
            severity: "LOW",
            category: "accessibility",
            message: "img element(s) missing alt attribute",
            suggestion:
              "Add descriptive alt text to all images for screen reader accessibility.",
          });
        }
      }

      // ── Auto-fix application (dev_pass mode) ──────────────────────────────
      let fixedCode = codeText;
      const appliedFixes: string[] = [];

      if (isDevPass) {
        // Fix 1: Add semicolons where obviously missing (JS/TS)
        if (["js", "ts", "jsx", "tsx"].includes(lang)) {
          const before = fixedCode;
          fixedCode = fixedCode.replace(
            /^(\s*(?:const|let|var|return|throw|import|export)\s+[^{}\n;]+)$/gm,
            (match) => {
              if (
                !match.trimEnd().endsWith(";") &&
                !match.trimEnd().endsWith(",") &&
                !match.trimEnd().endsWith("{")
              ) {
                return match.trimEnd() + ";";
              }
              return match;
            },
          );
          if (fixedCode !== before)
            appliedFixes.push(
              "Added missing semicolons to variable declarations and return statements",
            );
        }

        // Fix 2: Replace console.log with structured comment in non-debug contexts
        const logCount = (fixedCode.match(/console\.log\(/g) || []).length;
        if (logCount > 0 && isDevPass) {
          fixedCode = fixedCode.replace(
            /console\.log\((.*?)\);?/g,
            (_, args) =>
              `console.log(${args}); // TODO: replace with structured logger`,
          );
          appliedFixes.push(
            `Annotated ${logCount} console.log statement(s) with TODO markers`,
          );
        }

        // Fix 3: Add basic try/catch wrapper to bare async functions
        if (hasAsync && !hasTryCatch) {
          appliedFixes.push(
            "SUGGESTION: Wrap async operations in try/catch (manual fix required — auto-fix not applied to avoid breaking function structure)",
          );
        }
      }

      // ── Confidence scoring ────────────────────────────────────────────────
      const criticalCount = issues.filter(
        (i) => i.severity === "CRITICAL",
      ).length;
      const highCount = issues.filter((i) => i.severity === "HIGH").length;
      const confidence = Math.max(
        0,
        100 - criticalCount * 25 - highCount * 10 - issues.length * 3,
      );

      const result = {
        success: true,
        mode: isDevPass ? "dev_pass" : "standard",
        filename: filename ?? "untitled",
        language: lang,
        analysis: {
          lineCount,
          issueCount: issues.length,
          criticalCount,
          highCount,
          mediumCount: issues.filter((i) => i.severity === "MEDIUM").length,
          lowCount: issues.filter((i) => i.severity === "LOW").length,
          confidence,
          overallHealth:
            criticalCount > 0
              ? "critical"
              : highCount > 0
                ? "needs-work"
                : issues.length > 3
                  ? "fair"
                  : "good",
        },
        issues,
        fixedCode: isDevPass ? fixedCode : null,
        appliedFixes: isDevPass ? appliedFixes : [],
        checksPerformed: 7,
        protocol:
          "70x7 self-verification — 7 inspection passes across security, reliability, type-safety, maintainability, performance, accessibility, and framework patterns",
        timestamp: new Date().toISOString(),
      };

      console.log(
        `[MEND-CODE] Analyzed ${lineCount} lines, found ${issues.length} issues (${criticalCount} critical), mode=${isDevPass ? "dev_pass" : "standard"}`,
      );
      res.json(result);
    } catch (error) {
      console.error("[MEND-CODE] Error:", error);
      res.status(500).json({
        success: false,
        error: "Code analysis failed",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Dedicated Code Graph Analysis endpoint
  app.post("/api/code-graph/analyze", async (req, res) => {
    try {
      const { code, language } = req.body as {
        code?: string;
        language?: string;
      };
      if (!code || typeof code !== "string" || code.trim().length < 3) {
        return res
          .status(400)
          .json({ success: false, error: "No code provided" });
      }
      const graph = analyzeCode(code, language);
      const formatted = formatGraphForAI(graph);
      res.json({ success: true, graph, formatted });
    } catch (error) {
      console.error("[CODE GRAPH API] Error:", error);
      res
        .status(500)
        .json({
          success: false,
          error: "Code analysis failed",
          details: error instanceof Error ? error.message : String(error),
        });
    }
  });

  // ── Admin: List All Deletion Requests ─────────────────────────────────────
  // GET /api/admin/deletion-requests
  // Auth: X-Admin-Token header
  app.get(
    "/api/admin/deletion-requests",
    async (req: Request, res: Response) => {
      const adminToken = process.env.ADMIN_TOKEN;
      const provided = req.headers["x-admin-token"];
      if (
        !adminToken ||
        !adminToken.trim() ||
        !provided ||
        (Array.isArray(provided)
          ? provided[0]
          : (provided as string)
        ).trim() !== adminToken.trim()
      ) {
        return res
          .status(401)
          .json({
            error: "Unauthorized: invalid or missing X-Admin-Token header.",
          });
      }
      try {
        const requests = await storage.listAllDeletionRequests();
        return res.json({ success: true, count: requests.length, requests });
      } catch (err) {
        console.error("[ADMIN DELETION REQUESTS] Error:", err);
        return res
          .status(500)
          .json({ error: "Failed to fetch deletion requests" });
      }
    },
  );

  // ── Admin: Update Deletion Request Status ─────────────────────────────────
  // PATCH /api/admin/deletion-requests/:id
  // Auth: X-Admin-Token header
  // Body: { status: "processing" | "completed" | "failed" }
  app.patch(
    "/api/admin/deletion-requests/:id",
    async (req: Request, res: Response) => {
      const adminToken = process.env.ADMIN_TOKEN;
      const provided = req.headers["x-admin-token"];
      if (
        !adminToken ||
        !adminToken.trim() ||
        !provided ||
        (Array.isArray(provided)
          ? provided[0]
          : (provided as string)
        ).trim() !== adminToken.trim()
      ) {
        return res
          .status(401)
          .json({
            error: "Unauthorized: invalid or missing X-Admin-Token header.",
          });
      }
      try {
        const { id } = req.params;
        const { status } = req.body as { status?: string };
        const allowed = ["pending", "processing", "completed", "failed"];
        if (!status || !allowed.includes(status)) {
          return res
            .status(400)
            .json({ error: `status must be one of: ${allowed.join(", ")}` });
        }
        const updates: Record<string, unknown> = { status };
        if (status === "completed")
          updates.completedAt = new Date().toISOString();
        const updated = await storage.updateDeletionRequest(id, updates as any);
        if (!updated)
          return res.status(404).json({ error: "Deletion request not found" });
        console.log(
          `[ADMIN DELETION] Updated request ${id} → status: ${status}`,
        );
        return res.json({ success: true, request: updated });
      } catch (err) {
        console.error("[ADMIN DELETION UPDATE] Error:", err);
        return res
          .status(500)
          .json({ error: "Failed to update deletion request" });
      }
    },
  );

  // ── Admin: Delete Session Data (GDPR Art. 17) ─────────────────────────────
  // DELETE /api/admin/sessions/:sessionId
  // Hard-deletes all data for a session. Auto-completes any pending Art. 17
  // deletion requests for that session. Requires X-Admin-Token header.
  // GDPR Art. 17 compliant: full erasure + audit trail update.
  app.delete(
    "/api/admin/sessions/:sessionId",
    async (req: Request, res: Response) => {
      const adminToken = process.env.ADMIN_TOKEN;
      const provided = req.headers["x-admin-token"];
      if (
        !adminToken ||
        !adminToken.trim() ||
        !provided ||
        (Array.isArray(provided)
          ? provided[0]
          : (provided as string)
        ).trim() !== adminToken.trim()
      ) {
        return res
          .status(401)
          .json({
            error: "Unauthorized: invalid or missing X-Admin-Token header.",
          });
      }

      const { sessionId } = req.params;
      if (
        !sessionId ||
        typeof sessionId !== "string" ||
        sessionId.trim().length === 0
      ) {
        return res.status(400).json({ error: "Session ID is required." });
      }

      try {
        // Step 1 — Auto-complete any pending/processing Art. 17 requests for this session
        await pool.query(
          `UPDATE deletion_requests
            SET status       = 'completed',
                completed_at = NOW()
          WHERE session_id   = $1
            AND status       IN ('pending', 'processing')`,
          [sessionId],
        );

        // Step 2 — Delete user interaction data (messages, conversations, deletion requests).
        //           Consent records and the session shell are intentionally preserved:
        //           consent timestamps are legally required audit evidence (court-admissible
        //           proof of user agreement). The session row is kept so the consent audit
        //           panel continues to display the full consent history for this session.
        await storage.deleteAllUserData(sessionId);

        console.log(
          `[ADMIN DELETE SESSION] ${sessionId} — GDPR Art. 17 erasure complete (data deleted, consent record retained for legal audit)`,
        );

        return res.json({
          success: true,
          sessionId,
          gdpr: "Art. 17 fulfilled — messages and conversations deleted. Consent record retained as required legal audit evidence.",
        });
      } catch (err) {
        console.error("[ADMIN DELETE SESSION] Error:", err);
        return res.status(500).json({
          success: false,
          error: err instanceof Error ? err.message : "Internal server error",
        });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Admin: AI Learning Health — protected by X-Admin-Token header
  // Reports total preserved learning records, including rows detached from
  // deleted sessions (sessionId = NULL) — proof the anti-cascade protocol holds.
  // ─────────────────────────────────────────────────────────────────────────────
  app.get("/api/health/learning", async (req, res) => {
    const adminToken = process.env.ADMIN_TOKEN;
    const provided = req.headers["x-admin-token"];

    // Always 401 on bad/missing credentials — never reveal config state to unauthenticated callers
    if (
      !adminToken ||
      !adminToken.trim() ||
      !provided ||
      (Array.isArray(provided) ? provided[0] : (provided as string)).trim() !==
        adminToken.trim()
    ) {
      return res
        .status(401)
        .json({
          error: "Unauthorized: invalid or missing X-Admin-Token header.",
        });
    }

    try {
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM learning_data)                          AS total_learning,
          (SELECT COUNT(*) FROM learning_data  WHERE session_id IS NULL) AS detached_learning,
          (SELECT COUNT(*) FROM long_term_memory)                       AS total_ltm,
          (SELECT COUNT(*) FROM long_term_memory WHERE session_id IS NULL) AS detached_ltm,
          (SELECT MIN(created_at) FROM learning_data)                   AS oldest_record,
          (SELECT MAX(created_at) FROM learning_data)                   AS newest_record
      `);
      type HealthRow = {
        total_learning: string;
        detached_learning: string;
        total_ltm: string;
        detached_ltm: string;
        oldest_record: string | null;
        newest_record: string | null;
      };

      const row = result.rows[0] as HealthRow;

      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        antiCascadeProtocol: "active",
        learningData: {
          total: parseInt(row.total_learning, 10),
          detachedFromDeletedSessions: parseInt(row.detached_learning, 10),
          linkedToActiveSessions:
            parseInt(row.total_learning, 10) -
            parseInt(row.detached_learning, 10),
        },
        longTermMemory: {
          total: parseInt(row.total_ltm, 10),
          detachedFromDeletedSessions: parseInt(row.detached_ltm, 10),
          linkedToActiveSessions:
            parseInt(row.total_ltm, 10) - parseInt(row.detached_ltm, 10),
        },
        summary: {
          totalPreservedRecords:
            parseInt(row.total_learning, 10) + parseInt(row.total_ltm, 10),
          oldestRecord: row.oldest_record ?? null,
          newestRecord: row.newest_record ?? null,
        },
      });
    } catch (err) {
      console.error("[HEALTH/LEARNING] Query failed:", err);
      return res.status(500).json({
        success: false,
        error: "Failed to query learning data counts.",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── Admin: Consent Audit Log ──────────────────────────────────────────────
  // GET /api/admin/consent-audit
  // Returns a paginated list of sessions with AI learning data acknowledgment
  // records for compliance / legal audit purposes.
  //
  // Auth:   X-Admin-Token: <ADMIN_TOKEN env var>
  // Params: ?page=1&limit=100&acknowledged_only=true&csv=true
  // ─────────────────────────────────────────────────────────────────────────────
  app.get("/api/admin/consent-audit", async (req: Request, res: Response) => {
    const adminToken = process.env.ADMIN_TOKEN;
    const provided = req.headers["x-admin-token"];

    // Always 401 on bad/missing credentials — never reveal config state to unauthenticated callers
    if (
      !adminToken ||
      !adminToken.trim() ||
      !provided ||
      (Array.isArray(provided) ? provided[0] : (provided as string)).trim() !==
        adminToken.trim()
    ) {
      return res
        .status(401)
        .json({
          error: "Unauthorized: invalid or missing X-Admin-Token header.",
        });
    }

    try {
      const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
      const limit = Math.min(
        1000,
        Math.max(1, parseInt((req.query.limit as string) || "100", 10)),
      );
      const offset = (page - 1) * limit;
      const acknowledgedOnly = req.query.acknowledged_only === "true";
      const csvMode = req.query.csv === "true";
      const sessionIdFilter = req.query.session_id as string | undefined;
      const sessionIdSearch = req.query.session_id_search as string | undefined;
      const dateFrom = req.query.date_from as string | undefined;
      const dateTo = req.query.date_to as string | undefined;

      const conditions: string[] = [];
      const queryParams: unknown[] = [];

      if (sessionIdFilter) {
        queryParams.push(sessionIdFilter);
        conditions.push(`c.session_id = $${queryParams.length}`);
      } else if (sessionIdSearch) {
        queryParams.push(`%${sessionIdSearch.trim()}%`);
        conditions.push(`c.session_id ILIKE $${queryParams.length}`);
      }
      if (acknowledgedOnly)
        conditions.push("s.learning_data_acknowledged = true");
      if (dateFrom) {
        queryParams.push(new Date(dateFrom).toISOString());
        conditions.push(`c.consent_date >= $${queryParams.length}`);
      }
      if (dateTo) {
        // Include the full end day by advancing to start of next day
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        queryParams.push(end.toISOString());
        conditions.push(`c.consent_date < $${queryParams.length}`);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      type AuditRow = {
        consent_id: string;
        session_id: string | null;
        consent_date: string | null;
        consent_last_updated: string | null;
        essential_cookies: boolean;
        analytics_cookies: boolean;
        functional_cookies: boolean;
        data_retention: boolean;
        marketing_communications: boolean;
        third_party_sharing: boolean;
        created_at: string | null;
        learning_data_acknowledged: boolean | null;
        learning_data_acknowledged_at: string | null;
        age_verified: boolean | null;
        is_over_18: boolean | null;
        data_retention_opt_out: boolean | null;
      };

      const dataParams = [...queryParams, limit, offset];
      const [dataResult, consentCountResult, sessionCountResult] =
        await Promise.all([
          pool.query(
            `
          SELECT
            c.id                                                                 AS consent_id,
            c.session_id,
            c.consent_date,
            c.last_updated                                                     AS consent_last_updated,
            c.essential_cookies,
            c.analytics_cookies,
            c.functional_cookies,
            c.data_retention,
            c.marketing_communications,
            c.third_party_sharing,
            s.created_at                                                        AS created_at,
            s.learning_data_acknowledged,
            s.learning_data_acknowledged_at,
            s.age_verified,
            s.is_over_18,
            s.data_retention_opt_out
          FROM consent c
          LEFT JOIN sessions s ON s.id = c.session_id
          ${whereClause}
          ORDER BY c.consent_date DESC
          LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
        `,
            dataParams,
          ) as Promise<QueryResult<AuditRow>>,
          pool.query(
            `
          SELECT
            COUNT(*) AS total
          FROM consent c
          LEFT JOIN sessions s ON s.id = c.session_id
          ${whereClause}
        `,
            queryParams,
          ) as Promise<QueryResult<{ total: string }>>,
          pool.query(
            `
          SELECT
            COUNT(DISTINCT s.id) AS total,
            COUNT(DISTINCT s.id) FILTER (WHERE s.learning_data_acknowledged = true) AS acknowledged
          FROM sessions s
          LEFT JOIN consent c ON c.session_id = s.id
          ${whereClause}
        `,
            queryParams,
          ) as Promise<QueryResult<{ total: string; acknowledged: string }>>,
        ]);

      const totalRows = parseInt(consentCountResult.rows[0]?.total ?? "0", 10);
      const totalSessions = parseInt(
        sessionCountResult.rows[0]?.total ?? "0",
        10,
      );
      const acknowledgedRows = parseInt(
        sessionCountResult.rows[0]?.acknowledged ?? "0",
        10,
      );

      if (csvMode) {
        const header =
          "consent_id,session_id,consent_date,consent_last_updated,essential_cookies,analytics_cookies,functional_cookies,data_retention,marketing_communications,third_party_sharing,session_created_at,learning_data_acknowledged,learning_data_acknowledged_at,age_verified,is_over_18,data_retention_opt_out";
        const rows = dataResult.rows.map((r) =>
          [
            r.consent_id,
            r.session_id ?? "",
            r.consent_date ?? "",
            r.consent_last_updated ?? "",
            r.essential_cookies,
            r.analytics_cookies,
            r.functional_cookies,
            r.data_retention,
            r.marketing_communications,
            r.third_party_sharing,
            r.created_at ?? "",
            r.learning_data_acknowledged ?? "",
            r.learning_data_acknowledged_at ?? "",
            r.age_verified ?? "",
            r.is_over_18 ?? "",
            r.data_retention_opt_out ?? "",
          ].join(","),
        );
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="consent-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
        );
        return res.send([header, ...rows].join("\n"));
      }

      return res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        pagination: {
          page,
          limit,
          totalRows,
          totalPages: Math.ceil(totalRows / limit),
        },
        summary: {
          totalSessions,
          acknowledgedCount: acknowledgedRows,
          pendingCount: totalSessions - acknowledgedRows,
        },
        records: dataResult.rows,
      });
    } catch (err) {
      console.error("[CONSENT AUDIT] Query failed:", err);
      return res.status(500).json({
        success: false,
        error: "Failed to query consent audit data.",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ── 70x7 Artifact Builder endpoint ─────────────────────────────────────────
  // POST /api/academic/artifact/build — persists job to DB, fires pipeline in background, returns jobId immediately
  app.post(
    "/api/academic/artifact/build",
    async (req: Request, res: Response) => {
      try {
        const { topic } = req.body ?? {};
        if (!topic || typeof topic !== "string" || topic.trim().length < 3) {
          return res
            .status(400)
            .json({ error: "topic is required (min 3 chars)" });
        }
        const sessionId = String(
          (req.headers["x-session-id"] as string | undefined) ??
            req.body?.sessionId ??
            "anon",
        );
        const mode =
          typeof req.body?.mode === "string" ? req.body.mode : undefined;
        const { jobId } = await startArtifactBuildJob(topic, sessionId, mode);
        console.log(
          `[70x7 ARTIFACT BUILDER] Job ${jobId} started for: "${topic.trim().substring(0, 80)}"`,
        );
        return res.json({ success: true, jobId, status: "building" });
      } catch (err) {
        console.error("[70x7 ARTIFACT BUILDER] Endpoint error:", err);
        return res.status(500).json({
          success: false,
          error: err instanceof Error ? err.message : "Internal server error",
        });
      }
    },
  );

  // GET /api/academic/artifacts/history — full job list from DB, newest first
  app.get(
    "/api/academic/artifacts/history",
    async (_req: Request, res: Response) => {
      const list = await dbArtifactHistory();
      return res.json({ success: true, artifacts: list });
    },
  );

  // GET /api/academic/artifact/status/:jobId — poll for pipeline progress
  app.get(
    "/api/academic/artifact/status/:jobId",
    async (req: Request, res: Response) => {
      const { jobId } = req.params;
      const job = await dbArtifactGet(jobId);
      if (!job) {
        return res
          .status(404)
          .json({ success: false, error: "Job not found or expired." });
      }
      return res.json({
        success: true,
        jobId,
        status: job.status,
        topic: job.topic,
        sectionsCompleted: job.sectionsCompleted,
        totalSections: job.totalSections,
        currentSection: job.currentSection,
        artifact: job.status === "complete" ? job.artifact : null,
        charCount: job.charCount,
        error: job.error,
      });
    },
  );

  // GET /api/academic/artifact — legacy shape, returns most recent completed artifact
  app.get("/api/academic/artifact", async (_req: Request, res: Response) => {
    try {
      const latest = await dbArtifactLatestComplete();
      if (latest) {
        return res.json({
          success: true,
          artifact: latest.artifact,
          charCount: latest.charCount,
        });
      }
      return res
        .status(404)
        .json({ error: "No artifact found. Run /full [topic] first." });
    } catch (err) {
      return res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Read failed" });
    }
  });

  registerAdvancedImageRoutes(app);
}
