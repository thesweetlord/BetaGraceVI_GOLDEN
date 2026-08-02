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

import fs from 'fs/promises';

/**
 * Thrown when Pollinations returns 402 — balance is zero, retrying is pointless.
 * Propagates through the pipeline so all remaining batches abort immediately.
 */
export class BalanceExhaustedError extends Error {
  readonly code = 'BALANCE_EXHAUSTED';
  constructor(message: string) {
    super(message);
    this.name = 'BalanceExhaustedError';
  }
}

/**
 * BetaGrace vI AI Frame Fetcher — Temporal Coherence Edition
 *
 * Fetch strategy: text-to-image GET via gen.pollinations.ai
 *
 *   - negativePrompt is appended as &negative= on every frame, dramatically
 *     reducing hallucination artifacts (constraint-ghosting tokens included).
 *   - previousFramePath and img2imgStrength are retained in the signature
 *     for forward-compatibility; gen.pollinations.ai returns 404 on POST
 *     img2img today, so we skip that attempt and go straight to GET.
 *   - 429 rate-limits are handled with Retry-After-aware backoff.
 *   - Exponential backoff covers transient 5xx and network errors.
 *
 * Endpoint: gen.pollinations.ai
 * Auth:     Authorization: Bearer {token} header
 */

const TEXT2IMG_TIMEOUT_MS = 45000;

export async function fetchImageWithRetry(
  prompt: string,
  seed: number,
  filePath: string,
  retries: number = 4,
  pollinationsKey?: string,
  negativePrompt?: string,
  previousFramePath?: string | null,
  img2imgStrength: number = 0.65,
): Promise<boolean> {
  // previousFramePath / img2imgStrength kept for API compatibility.
  // img2img POST is not yet supported by gen.pollinations.ai (404).
  void previousFramePath;
  void img2imgStrength;

  const cleanPrompt = prompt
    .replace(/\*\*/g, '')
    .replace(/^\[IMAGE:\s*/i, '')
    .replace(/\]\s*$/, '')
    .trim();

  const authHeaders: Record<string, string> = {
    'User-Agent': 'BetaGrace/vI',
  };
  if (pollinationsKey) {
    authHeaders['Authorization'] = `Bearer ${pollinationsKey}`;
  }

  // ── Text-to-image GET ──────────────────────────────────────────────────────
  const enc = encodeURIComponent(cleanPrompt.substring(0, 1400));
  let url = `https://gen.pollinations.ai/image/${enc}?model=flux&width=1024&height=576&nologo=true&enhance=false&seed=${seed}`;
  if (negativePrompt) {
    url += `&negative=${encodeURIComponent(negativePrompt.substring(0, 1200))}`;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), TEXT2IMG_TIMEOUT_MS);

      const res = await fetch(url, { signal: controller.signal, headers: authHeaders });
      clearTimeout(tid);

      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After');
          const wait = retryAfter
            ? Math.min(parseInt(retryAfter, 10) * 1000, 120000)
            : 30000;
          console.warn(`[AI Engine] 429 rate-limit (attempt ${attempt}/${retries}). Waiting ${wait / 1000}s...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        // BUG FIX 1: 402 means balance is zero — retrying is pointless.
        // Throw a typed error that propagates up so the pipeline can abort
        // immediately instead of burning through all 4 retries × remaining frames.
        if (res.status === 402) {
          const body = await res.text().catch(() => '');
          console.error(`[AI Engine] 402 Insufficient Balance — aborting immediately. ${body.substring(0, 200)}`);
          throw new BalanceExhaustedError('Pollinations balance exhausted (402). Top up pollen to continue.');
        }
        if (res.status >= 500) throw new Error(`Server error: ${res.status}`);
        throw new Error(`API Error: ${res.status}`);
      }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500) {
        throw new Error(`Response too small (${buf.length}b) — likely an error page`);
      }

      await fs.writeFile(filePath, buf);
      console.log(`[AI Engine] Frame saved (${buf.length}b) → ${filePath}`);
      return true;

    } catch (error: any) {
      // BUG FIX 1 (cont.): Let BalanceExhaustedError propagate — do NOT swallow it.
      // All other errors are logged and retried with backoff.
      if (error instanceof BalanceExhaustedError) throw error;
      console.warn(`[AI Engine] Attempt ${attempt}/${retries} failed (seed ${seed}): ${error.message}`);
      if (attempt === retries) {
        console.error(`[AI Engine] All ${retries} retries exhausted for seed ${seed}.`);
        return false;
      }
      const wait = Math.pow(2, attempt) * 1000;
      console.log(`[AI Engine] Backing off ${wait / 1000}s before retry ${attempt + 1}...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return false;
}
