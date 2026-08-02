/**
 * BetaGrace vI — Atomic Video Compiler
 *
 * Enforces absolute pathing and atomic directory clearing for every render job,
 * eliminating the "Preview vs. Render" discrepancy caused by stale frames or
 * misaligned buffer state from prior incomplete or crashed runs.
 *
 * Root cause of the discrepancy:
 *   `temp_frames/<jobId>` was never wiped before a new render started writing
 *   into it. If a prior job crashed mid-download, FFmpeg silently picked up the
 *   residual frames alongside the new ones, producing a mismatched frame buffer.
 *
 * Fix:
 *   1. All render directories live under an absolute `tmp/render/<jobId>` path.
 *   2. `sanitizeRenderDir()` performs a synchronous wipe-then-recreate — sync is
 *      intentional: an async gap between rmdir and mkdir would let a concurrent
 *      coroutine observe a missing directory and throw.
 *   3. `atomicCompileVideo()` resolves all paths to absolute before handing off
 *      to FFmpeg, removing any relative-path ambiguity between cwd contexts.
 */

import fs from 'fs';
import path from 'path';
import { compileVideoSafe } from './ffmpeg-compile.js';

// ── Canonical render base ─────────────────────────────────────────────────────
// All per-job render directories are children of this resolved absolute path.
// path.resolve() is used (not path.join) to guarantee an absolute path even if
// process.cwd() behaves unexpectedly in a spawned child context.
export const RENDER_BASE = path.resolve(process.cwd(), 'tmp', 'render');

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the absolute, job-scoped render directory for `jobId`.
 * All frame writes and concat lists go here — never a relative path.
 */
export function getRenderDir(jobId: string): string {
  return path.resolve(RENDER_BASE, jobId);
}

// ── Atomic sanitization ───────────────────────────────────────────────────────

/**
 * Atomically prepare a clean render directory for `jobId`:
 *
 *   1. If the directory already exists (stale frames from a prior crashed run)
 *      it is wiped synchronously with `rmSync({ recursive: true, force: true })`.
 *   2. The directory is then recreated synchronously with `mkdirSync`.
 *
 * Synchronous ops are deliberate — they guarantee no async gap exists between
 * the wipe and the recreate during which another concurrent request could observe
 * a missing path and throw ENOENT.
 *
 * @returns The absolute path to the clean render directory.
 */
export function sanitizeRenderDir(jobId: string): string {
  const renderDir = getRenderDir(jobId);

  if (fs.existsSync(renderDir)) {
    fs.rmSync(renderDir, { recursive: true, force: true });
    console.log(`[Compiler] Stale render dir wiped: ${renderDir}`);
  }

  fs.mkdirSync(renderDir, { recursive: true });
  console.log(`[Compiler] Clean render dir created: ${renderDir}`);

  return renderDir;
}

// ── Compile wrapper ───────────────────────────────────────────────────────────

/**
 * Atomic compile entry point.
 *
 * - Resolves `outputPath` to an absolute path (eliminates cwd-relative bugs).
 * - Ensures the output directory exists before FFmpeg tries to write to it.
 * - Delegates frame encoding to `compileVideoSafe` from ffmpeg-compile.ts.
 *
 * The `framesDir` passed here must already have been prepared via
 * `sanitizeRenderDir()` — this function does NOT wipe it again, so that
 * in-progress frame downloads are not lost if something calls compile
 * before all frames have landed.
 *
 * @param framesDir   Absolute path to the directory containing frame files.
 * @param outputPath  Desired output MP4 path (resolved to absolute internally).
 * @param totalDurationSeconds  Target video duration fed to the concat encoder.
 * @returns Absolute path to the compiled MP4.
 */
export async function atomicCompileVideo(
  framesDir: string,
  outputPath: string,
  totalDurationSeconds: number = 90,
): Promise<string> {
  const absFramesDir = path.resolve(framesDir);
  const absOutputPath = path.resolve(outputPath);

  // Guarantee the output directory exists (e.g. attached_assets/generated_videos)
  fs.mkdirSync(path.dirname(absOutputPath), { recursive: true });

  console.log(`[Compiler] atomicCompileVideo → frames: ${absFramesDir} | out: ${absOutputPath}`);

  return compileVideoSafe(absFramesDir, absOutputPath, totalDurationSeconds);
}
