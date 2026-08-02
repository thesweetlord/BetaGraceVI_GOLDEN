import path from 'path';
import fs from 'fs/promises';
import { fetchImageWithRetry, BalanceExhaustedError } from './ai.js';
import {
  BASE_NEGATIVE_PROMPTS,
  POSITIVE_ANATOMY_REINFORCEMENT,
  computeFrameSeed,
} from './video-prompt-engine.js';

// WISDOM: 3 concurrent fetches keeps us under Replit's memory ceiling while
// being fast enough that a 20-scene render finishes in a reasonable time.
const CONCURRENCY_LIMIT = 3;

/**
 * BetaGrace vI Breathing Pipeline — Temporal Coherence Edition
 *
 * Three-layer coherence strategy per batch cycle:
 *
 *   Layer 1 — Structured negative prompts:
 *     Every frame receives the full BASE_NEGATIVE_PROMPTS list built by
 *     video-prompt-engine.ts. This suppresses the most common hallucination
 *     artifacts (deformed anatomy, text bleed, temporal flicker) on every
 *     single frame even without a previous-frame reference.
 *
 *   Layer 2 — Prime-multiplied seed drift:
 *     Each frame uses seed = masterSeed + frameIndex × 7. The prime multiplier
 *     creates a smooth, non-repeating walk through the latent space. The old
 *     12-frame chunk approach caused visible visual "jumps" at chunk boundaries.
 *
 *   Layer 3 — Batch-anchor img2img (visual memory):
 *     After each batch of CONCURRENCY_LIMIT frames completes, we find the last
 *     successful frame and set it as the "anchor" for the ENTIRE next batch.
 *     All frames in the next batch receive that anchor as their img2img input.
 *
 *     WHY NOT per-frame chaining? Because within a batch frames run in parallel —
 *     frame N+1 cannot use frame N as a reference if they start at the same time.
 *     Using the previous batch's last frame as a shared anchor lets us maintain
 *     img2img coherence across batch boundaries without serialising generation.
 *
 *   Fallback:
 *     Failed frames are filled by scanning backward then forward through the
 *     succeeded set after ALL batches complete, so every frame in the output
 *     directory is populated before FFmpeg runs.
 */
export async function processVideoFramesSafe(
  prompts: string[],
  masterSeed: number,
  outputDir: string,
  pollinationsKey?: string,
  perSceneSeeds?: number[],
): Promise<string[]> {
  await fs.mkdir(outputDir, { recursive: true });

  const allPaths = prompts.map((_, i) =>
    path.join(outputDir, `frame_${i.toString().padStart(5, '0')}.jpg`),
  );
  const succeeded = new Set<number>();

  // The last successful frame from the previous batch — used as img2img anchor.
  // Starts null so the very first batch uses pure text-to-image.
  let batchAnchorPath: string | null = null;

  // BUG FIX 2: Track balance exhaustion so we abort remaining batches immediately
  // instead of burning through all retries × remaining frames pointlessly.
  let balanceExhausted = false;

  console.log(
    `[Pipeline] Starting coherent generation of ${prompts.length} frames` +
    ` (batch=${CONCURRENCY_LIMIT}, seed_drift=prime×7, negatives=ghosted)`,
  );

  for (let i = 0; i < prompts.length; i += CONCURRENCY_LIMIT) {
    // BUG FIX 2: Skip all remaining batches the moment balance is gone.
    if (balanceExhausted) {
      const batchNum    = Math.floor(i / CONCURRENCY_LIMIT) + 1;
      const totalBatches = Math.ceil(prompts.length / CONCURRENCY_LIMIT);
      console.warn(`[Pipeline] Batch ${batchNum}/${totalBatches} SKIPPED — balance exhausted.`);
      continue;
    }

    const batch = prompts.slice(i, i + CONCURRENCY_LIMIT);

    // Snapshot the anchor for this batch — all frames in the batch share it.
    const anchorForThisBatch = batchAnchorPath;

    const batchPromises = batch.map(async (prompt, batchIndex) => {
      const absoluteIndex = i + batchIndex;
      const filePath      = allPaths[absoluteIndex];

      // ── FIDELITY FIX ───────────────────────────────────────────────────────
      // Use the hydrated scene prompt DIRECTLY as the positive — this is the
      // same text the storyboard preview sends to Pollinations, so the render
      // now matches the preview exactly.
      //
      // WHY we no longer use generateCoherentPrompt(promptStringToComponent()):
      //   promptStringToComponent() maps the full text to sceneComponents.subject.
      //   The rescue-plan sequence removed `subject` from the positive output
      //   (environment goes first, then the semantic break, then the anchor).
      //   Result: the entire scene text was silently dropped and every frame
      //   rendered from POSITIVE_ANATOMY_REINFORCEMENT alone → women with hands.
      //
      // The hydrated scene string already contains environment + action +
      // cameraAngle + lighting + detail + style in the right order from
      // VideoHydrationEngine._buildPayload. We append anatomy reinforcement
      // as a tail token and let BASE_NEGATIVE_PROMPTS do the rest.
      const cleanPrompt = prompt.trim();
      const positive = [cleanPrompt, POSITIVE_ANATOMY_REINFORCEMENT]
        .filter(Boolean).join(', ');
      const negative = BASE_NEGATIVE_PROMPTS.join(', ');

      // Use per-scene seed from hydration engine if available, otherwise drift-formula
      const frameSeed = (perSceneSeeds && perSceneSeeds[absoluteIndex] !== undefined)
        ? perSceneSeeds[absoluteIndex]
        : computeFrameSeed(masterSeed, absoluteIndex);

      // Layer 3: img2img anchor (shared across the whole batch)
      // BalanceExhaustedError propagates out of fetchImageWithRetry uncaught here
      // and is caught by the try/catch wrapping Promise.all below.
      const success = await fetchImageWithRetry(
        positive,
        frameSeed,
        filePath,
        4,
        pollinationsKey,
        negative,
        anchorForThisBatch,
        0.65,
      );

      if (success) {
        succeeded.add(absoluteIndex);
      }
    });

    try {
      await Promise.all(batchPromises);
    } catch (err) {
      if (err instanceof BalanceExhaustedError) {
        // BUG FIX 2: One frame in this batch hit 402 — flag and continue to
        // post-processing so we still compile a partial video with what we have.
        balanceExhausted = true;
        console.error(`[Pipeline] Balance exhausted mid-batch — stopping generation. ${succeeded.size}/${prompts.length} frames succeeded.`);
      } else {
        throw err;
      }
    }

    // Update anchor: find the highest-indexed successful frame in this batch.
    // This gives the next batch the "most recent" visual reference.
    for (let j = i + batch.length - 1; j >= i; j--) {
      if (succeeded.has(j)) {
        batchAnchorPath = allPaths[j];
        break;
      }
    }

    const batchNum    = Math.floor(i / CONCURRENCY_LIMIT) + 1;
    const totalBatches = Math.ceil(prompts.length / CONCURRENCY_LIMIT);
    console.log(
      `[Pipeline] Batch ${batchNum}/${totalBatches} done.` +
      ` Succeeded: ${succeeded.size}/${i + batch.length}.` +
      ` Next anchor: ${batchAnchorPath ? path.basename(batchAnchorPath) : 'none'}`,
    );
  }

  // Expose balance state so callers can surface a user-friendly error message.
  (processVideoFramesSafe as any)._lastBalanceExhausted = balanceExhausted;

  // ── Post-processing: fill any failed frames with the nearest successful one ──
  const finalPaths: string[] = [];

  for (let i = 0; i < allPaths.length; i++) {
    if (succeeded.has(i)) {
      finalPaths.push(allPaths[i]);
      continue;
    }

    let donor: string | null = null;
    for (let offset = 1; offset < allPaths.length && !donor; offset++) {
      if (i - offset >= 0 && succeeded.has(i - offset)) donor = allPaths[i - offset];
      if (!donor && i + offset < allPaths.length && succeeded.has(i + offset)) donor = allPaths[i + offset];
    }

    if (donor) {
      try {
        await fs.copyFile(donor, allPaths[i]);
        console.log(`[Pipeline] Fallback: frame ${i} ← ${path.basename(donor)}`);
        finalPaths.push(allPaths[i]);
      } catch (e) {
        console.error(`[Pipeline] Fallback copy failed for frame ${i}:`, e);
      }
    } else {
      console.error(`[Pipeline] Frame ${i} has no fallback — zero successful frames generated.`);
    }
  }

  console.log(`[Pipeline] Complete. ${finalPaths.length}/${prompts.length} frames ready.`);
  return finalPaths;
}
