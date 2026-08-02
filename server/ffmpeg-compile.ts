import { createRequire } from 'module';
import { spawn, execSync } from 'child_process';
import { existsSync, chmodSync, readdirSync, statSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

const _require = createRequire(import.meta.url);

/**
 * Resolve the FFmpeg binary path at call time.
 * Priority order:
 *   1. ffmpeg-static bundled binary (after ensuring execute permission)
 *   2. System FFmpeg via `command -v ffmpeg` (Nix-aware)
 *   3. Throw — video compilation is impossible
 */
function resolveFfmpegBin(): string {
  try {
    const ffmpegStatic = _require('ffmpeg-static') as string | null;
    if (ffmpegStatic && existsSync(ffmpegStatic)) {
      try {
        chmodSync(ffmpegStatic, 0o755);
      } catch {
        // chmod failed — try anyway, OS may still allow execution
      }
      return ffmpegStatic;
    }
  } catch {
    // ffmpeg-static not installed — fall through
  }

  // `which` fails on Nix; use shell built-in `command -v` instead
  try {
    const p = execSync('command -v ffmpeg', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/sh',
    }).trim();
    if (p && existsSync(p)) return p;
  } catch {
    // not on PATH
  }

  throw new Error('FFmpeg binary not found. Install ffmpeg-full via Nix or add ffmpeg to PATH.');
}

/**
 * Cross-platform FFmpeg video compiler.
 *
 * Reads all `frame_NNNNN.jpg` files from `framesDir`, builds a concat list
 * so each frame occupies an equal share of `totalDurationSeconds`, then
 * encodes the final MP4.
 *
 * WISDOM:
 * -threads 2  → Caps CPU usage, keeping the Express server responsive during
 *               encoding — safe default on all platforms.
 * -preset veryfast → Encodes 4-5× faster than the default with lower peak
 *                    memory — ideal for concurrent server environments.
 */
export async function compileVideoSafe(
  framesDir: string,
  outputPath: string,
  totalDurationSeconds: number = 90,
): Promise<string> {
  const ffmpegBin = resolveFfmpegBin();
  const absFramesDir = path.resolve(framesDir);
  const jobStartTime = Date.now();

  // ── Step 3: Path verification log ────────────────────────────────────────
  console.log(`[FFmpeg] Compiling from: ${absFramesDir}`);

  // ── Temporal lock — reject any frame file older than 10 minutes ──────────
  // Guards against stale files that survived an incomplete prior sanitization.
  // 600-second window is intentionally generous: a 20-scene render at 3-frame
  // concurrency typically finishes in under 3 minutes; 10 min is the hard cap.
  const TEMPORAL_LOCK_MS = 600_000;
  const now = Date.now();

  const rawEntries = readdirSync(absFramesDir);
  const framePaths = rawEntries
    .filter((f) => {
      if (!/^frame_\d{5}\.(jpg|jpeg|png|webp)$/i.test(f)) return false;
      const filePath = path.join(absFramesDir, f);
      try {
        const stats = statSync(filePath);
        const ageMs = now - stats.mtimeMs;
        if (ageMs > TEMPORAL_LOCK_MS) {
          console.warn(
            `[FFmpeg] Temporal lock REJECTED stale frame: ${f} ` +
            `(${Math.round(ageMs / 1000)}s old, limit ${TEMPORAL_LOCK_MS / 1000}s)`,
          );
          return false;
        }
        return true;
      } catch {
        return false;
      }
    })
    .sort()
    .map((f) => path.resolve(path.join(absFramesDir, f)).replace(/\\/g, '/'));

  // ── Step 3: Zero-frame guard ─────────────────────────────────────────────
  // If the temporal lock filtered everything out, abort instead of rendering
  // a hallucinated video from stale buffers.
  if (framePaths.length === 0) {
    throw new Error(
      `[FFmpeg] CRITICAL: No valid frames found in ${absFramesDir} after temporal lock. ` +
      `All files were either missing or older than ${TEMPORAL_LOCK_MS / 1000}s. ` +
      `This prevents stale-buffer hallucination — check frame generation logs.`,
    );
  }

  // ── Step 3: Frame integrity — log first frame resolution via ffprobe ──────
  try {
    const firstFrame = framePaths[0];
    const probeOut = execSync(
      `"${ffmpegBin}" -hide_banner -i "${firstFrame}" -vframes 0 -f null - 2>&1 | grep "Video:"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell: '/bin/sh' },
    ).trim();
    console.log(`[FFmpeg] Frame integrity — first frame (${path.basename(firstFrame)}): ${probeOut || 'ok'}`);
  } catch {
    // ffprobe-style check is best-effort; don't abort if it fails
    console.log(`[FFmpeg] Frame integrity check skipped (ffprobe unavailable) — proceeding.`);
  }

  const frameDuration = Number(
    (totalDurationSeconds / framePaths.length).toFixed(3),
  );

  // Build concat list: each frame gets an equal duration slice
  const concatListPath = path.join(framesDir, 'concat_list.txt');
  const lines: string[] = [];
  for (const fp of framePaths) {
    lines.push(`file '${fp}'`);
    lines.push(`duration ${frameDuration}`);
  }
  // FFmpeg requires the last file to appear twice (no trailing duration)
  lines.push(`file '${framePaths[framePaths.length - 1]}'`);
  await fs.writeFile(concatListPath, lines.join('\n'));

  console.log(
    `[FFmpeg] Weaving ${framePaths.length} frames → ${outputPath}` +
    ` (${frameDuration}s/frame, threads:2, preset:veryfast)` +
    ` using binary: ${ffmpegBin}`,
  );

  return new Promise((resolve, reject) => {
    // ── Step 1 & 2: High-fidelity encoder settings ───────────────────────────
    // -crf 12        → Near-lossless quality (was 23). Preserves every pixel of
    //                  the AI-generated frames without compression smearing.
    // -preset veryslow → Max analysis time for the encoder; preserves chiaroscuro
    //                  detail and dark-scene gradients that veryfast discards.
    // -vf "format=yuv420p,scale=..."
    //                → Explicit color-space conversion BEFORE compression starts.
    //                  Prevents "muddy" artifacts when RGBA/RGB frames are
    //                  converted to YUV implicitly mid-encode. The scale filter
    //                  forces even pixel dimensions (required by yuv420p).
    // -movflags +faststart → Writes moov atom at file head; player can seek
    //                  without buffering the full file.
    const ffmpegArgs = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-threads', '2',
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level:v', '4.1',
      '-preset', 'veryslow',
      '-crf', '12',
      '-vf', 'format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-movflags', '+faststart',
      outputPath,
    ];

    const ffmpegProcess = spawn(ffmpegBin, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    ffmpegProcess.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 10240) stderr = stderr.slice(-10240);
    });

    // 3-minute hard timeout
    const timeoutId = setTimeout(() => {
      ffmpegProcess.kill('SIGTERM');
      reject(new Error('[FFmpeg] Compile timed out after 180 seconds.'));
    }, 180000);

    ffmpegProcess.on('close', (code: number | null) => {
      clearTimeout(timeoutId);
      if (code === 0) {
        console.log(`[FFmpeg] Video compiled successfully: ${outputPath}`);
        resolve(outputPath);
      } else {
        console.error(`[FFmpeg] Process exited with code ${code}`);
        reject(new Error(`FFmpeg failed (code ${code}): ${stderr.slice(-2000)}`));
      }
    });

    ffmpegProcess.on('error', (err: Error) => {
      clearTimeout(timeoutId);
      console.error('[FFmpeg] Process error:', err);
      reject(err);
    });
  });
}
