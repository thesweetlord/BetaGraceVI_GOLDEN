/**
 * BetaGrace vI Video Hydration Engine — Pollinations-Powered Storyboard Architect
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS — THE FIVE ROOT CAUSES OF PIPELINE UNRELIABILITY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ROOT CAUSE 1 — extractVideoSubject() truncates to 90 chars.
 *    Every rich creative intent gets axed to 90 chars before any scene is
 *    generated. The model never sees the full intent.
 *    → FIX: Model reads the FULL raw prompt, no truncation.
 *
 *  ROOT CAUSE 2 — generateScenePrompts() builds flat strings, not components.
 *    video-prompt-engine.ts's SceneComponent system exists to give every frame
 *    a structured, stable anchor. But routes.ts bypasses it entirely.
 *    → FIX: Model outputs structured SceneComponent objects for every scene.
 *
 *  ROOT CAUSE 3 — Prompt truncated to 900 chars in ai.ts.
 *    BASE_NEGATIVE_PROMPTS after ghosting is ~2400 chars. The 500-char cap
 *    guts it. → FIX: Bumped to 1400/1200 in ai.ts.
 *
 *  ROOT CAUSE 4 — img2img Layer 3 is dead code.
 *    pipeline.ts tracks batchAnchorPath correctly, but ai.ts does:
 *      void previousFramePath; void img2imgStrength;
 *    → FIX: Documented clearly; Stability fallback hook ready.
 *
 *  ROOT CAUSE 5 — No database persistence for video jobs.
 *    Every pipeline run starts from zero.
 *    → FIX: VideoJob + VideoScene tables in Drizzle (shared/db-schema.ts).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { db } from './db.js';
import { videoJobs, videoScenes } from '../shared/db-schema.js';
import { eq } from 'drizzle-orm';
import type { SceneComponent } from './video-prompt-engine.js';

export type CameraMotion =
  | 'static'
  | 'pan_left'
  | 'pan_right'
  | 'pan_up'
  | 'pan_down'
  | 'zoom_in'
  | 'zoom_out'
  | 'ken_burns';

export interface HydratedScene {
  sceneIndex: number;
  sceneId: string;
  components: SceneComponent;
  positivePrompt: string;
  negativeOverrides: string[];
  cameraMotion: CameraMotion;
  durationSeconds: number;
  coherenceGroup: number;
  seed: number;
  metadata: {
    act: number;
    chapterTitle: string;
    sceneName: string;
    emotionalBeat: string;
  };
}

export interface HydrationPayload {
  jobId: string;
  masterSeed: number;
  totalScenes: number;
  scenes: HydratedScene[];
  globalStyle: string;
  globalCharacterAnchor: string;
  globalNegativeOverrides: string[];
  ffmpegPolicy: {
    targetFps: number;
    targetWidth: number;
    targetHeight: number;
    targetCodec: 'libx264';
    targetCrf: number;
    defaultMotion: CameraMotion;
  };
}

const POLLINATIONS_ENDPOINT = 'https://gen.pollinations.ai/v1/chat/completions';
const HYDRATION_MODEL = 'openai';
const HYDRATION_TIMEOUT_MS = 120_000;

export class VideoHydrationEngine {

  /**
   * THE MAIN ENTRY POINT.
   * Takes the user's raw creative intent (no truncation, no cleaning),
   * calls the Pollinations unified API to expand it into a full structured
   * storyboard, persists the job to Drizzle, and returns the HydrationPayload.
   */
  async hydrate(
    rawIntent: string,
    numScenes: number = 20,
    sessionId?: string,
    jobId?: string,
  ): Promise<HydrationPayload> {
    if (jobId) {
      const existing = await this._loadExistingJob(jobId);
      if (existing) {
        console.log(`[Hydration] Resuming existing job ${jobId} (${existing.scenes.length} scenes loaded)`);
        return existing;
      }
    }

    const systemInstruction = this._buildSystemInstruction(numScenes);
    const userPrompt = this._buildUserPrompt(rawIntent, numScenes);

    console.log(`[Hydration] Calling Pollinations to expand storyboard (${numScenes} scenes)...`);

    let rawStoryboard: any;
    try {
      rawStoryboard = await this._callPollinations(systemInstruction, userPrompt);
    } catch (err: any) {
      throw new Error(`[Hydration] Pollinations API call failed: ${err.message}`);
    }

    const newJobId = jobId ?? `vj_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    const payload = this._buildPayload(rawStoryboard, newJobId, numScenes);

    this._persistJob(payload, rawIntent, sessionId).catch((err) =>
      console.error('[Hydration] DB persistence failed (non-fatal):', err),
    );

    console.log(
      `[Hydration] ✓ ${payload.scenes.length} scenes hydrated. ` +
      `Job: ${newJobId} | Master seed: ${payload.masterSeed} | ` +
      `Style: "${payload.globalStyle.substring(0, 60)}..."`,
    );

    return payload;
  }

  static buildPositivePrompt(scene: HydratedScene): string {
    const c = scene.components;
    return [c.subject, c.action, c.environment, c.cameraAngle, c.lighting, c.mood, c.detail, c.style]
      .filter(Boolean)
      .join(', ');
  }

  static buildNegativeComponents(scene: HydratedScene, globalNegativeOverrides: string[]): string[] {
    return [...globalNegativeOverrides, ...scene.negativeOverrides];
  }

  private async _callPollinations(systemPrompt: string, userMessage: string): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HYDRATION_TIMEOUT_MS);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const pollinationsToken = process.env.POLLINATIONS_API_KEY;
    if (pollinationsToken) headers['Authorization'] = `Bearer ${pollinationsToken}`;

    let response: Response;
    try {
      response = await fetch(POLLINATIONS_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          model: HYDRATION_MODEL,
          response_format: { type: 'json_object' },
          private: true,
          seed: Math.floor(Math.random() * 1_000_000),
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Pollinations returned ${response.status}: ${body.substring(0, 200)}`);
    }

    const raw = await response.text();
    return this._extractJson(raw);
  }

  /** Robustly extract JSON from a Pollinations chat-completion response.
   *  Handles: raw JSON, markdown code fences, OpenAI-compat content wrapper. */
  private _extractJson(raw: string): any {
    // Try parsing as an OpenAI-compat chat completion envelope first
    try {
      const envelope = JSON.parse(raw);
      // OpenAI response shape: choices[0].message.content
      const content = envelope?.choices?.[0]?.message?.content;
      if (typeof content === 'string') {
        return this._parseJsonString(content);
      }
      // If it's already the storyboard object (no envelope), return it
      if (envelope?.scenes) return envelope;
    } catch {
      // Not valid JSON at the top level — fall through to string parse
    }
    return this._parseJsonString(raw);
  }

  /** Strip markdown fences then JSON.parse */
  private _parseJsonString(text: string): any {
    // Strip ```json ... ``` or ``` ... ``` fences
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const cleaned = fenceMatch ? fenceMatch[1].trim() : text.trim();

    // Find first { to last } to extract JSON object robustly
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) {
      throw new Error(`No JSON object found in Pollinations response. Raw (first 300): ${text.substring(0, 300)}`);
    }
    const jsonSlice = cleaned.slice(start, end + 1);

    try {
      return JSON.parse(jsonSlice);
    } catch (parseErr) {
      throw new Error(`JSON parse failed: ${(parseErr as Error).message}. Slice (first 300): ${jsonSlice.substring(0, 300)}`);
    }
  }

  private _buildSystemInstruction(numScenes: number): string {
    return `You are an elite cinematic storyboard director AND image-generation prompt architect.

Your job: receive a user's raw creative intent and output EXACTLY one JSON object — no explanation, no markdown, no preamble — matching this schema precisely:

{
  "globalStyle": "string — consistent visual style appended to every scene",
  "globalCharacterAnchor": "string — Extremely specific, unchanging physical description of the main subjects (e.g., 'A pale 30-year-old woman with silver hair wearing a tattered grey trench coat and a jagged iron cross necklace'). This MUST remain identical.",
  "globalNegativeOverrides": ["string array — style-specific negatives to add to base negative list"],
  "masterSeed": <integer between 1000 and 999999>,
  "ffmpegPolicy": {
    "targetFps": 24,
    "targetWidth": 1920,
    "targetHeight": 1080,
    "targetCodec": "libx264",
    "targetCrf": 18,
    "defaultMotion": "ken_burns"
  },
  "scenes": [
    {
      "sceneIndex": 0,
      "sceneName": "string",
      "chapterTitle": "string",
      "act": 1,
      "emotionalBeat": "string",
      "subject": "string — SPECIFIC, VISUAL, CONCRETE. Good: 'a pale dark-haired woman in torn white linen, gaunt, kneeling on cracked earth, tears streaming'. Bad: 'a woman'.",
      "action": "string — what the subject is actively doing RIGHT NOW",
      "environment": "string — specific, paintable setting description",
      "style": "string — visual/aesthetic style for THIS scene",
      "cameraAngle": "string — cinematically precise angle and framing",
      "lighting": "string — quality, direction, color, source",
      "mood": "string — atmospheric mood keywords",
      "detail": "string — one specific micro-detail that makes this scene unique",
      "cameraMotion": "static|pan_left|pan_right|pan_up|pan_down|zoom_in|zoom_out|ken_burns",
      "durationSeconds": 5.0,
      "coherenceGroup": 1,
      "negativeOverrides": ["string array"]
    }
  ]
}

LAWS YOU MUST OBEY:
1. Output ONLY the JSON object. No text before or after.
2. scenes array must contain EXACTLY ${numScenes} objects.
3. Subject field must be CHARACTER-CONSISTENT across scenes sharing the same person — you are the model's memory.
4. Fill every field with specific, paintable visual language. Vague = bad frames.
5. Coherence groups: same integer for scenes sharing location/character/time-of-day.
6. Camera motion must match emotional beat:
   static=weight/dread, zoom_in=intensity/revelation, zoom_out=isolation/scale,
   ken_burns=cinematic default, pan_left/right=discovery/following action, pan_up=awe/scale.`;
  }

  private _buildUserPrompt(rawIntent: string, numScenes: number): string {
    return `USER CREATIVE INTENT (full text — read every word before generating):
═══════════════════════════════════════════════════════
${rawIntent}
═══════════════════════════════════════════════════════

Generate exactly ${numScenes} scenes that faithfully serve this creative intent.

Requirements:
- Read the ENTIRE intent above — do not truncate or summarize it
- Every scene needs EVERY field filled with specific, paintable visual language
- Subject must be consistent across related scenes (you are the model's memory)
- Coherence groups must be thoughtfully assigned
- Camera motion must match the emotional beat
- globalStyle must distill the ESSENCE of the visual aesthetic from the intent
- Output ONLY the JSON object — nothing else`;
  }

  private _buildPayload(raw: any, jobId: string, numScenes: number): HydrationPayload {
    const masterSeed = Number(raw.masterSeed) || Math.floor(Math.random() * 999000) + 1000;
    const globalCharacterAnchor: string = raw.globalCharacterAnchor || '';

    const scenes: HydratedScene[] = (raw.scenes as any[])
      .slice(0, numScenes)
      .map((s: any, idx: number): HydratedScene => {
        const sceneIndex = Number(s.sceneIndex ?? idx);
        const sceneId = `scene_${String(sceneIndex).padStart(3, '0')}`;

        const components: SceneComponent = {
          subject:     s.subject     || '',
          action:      s.action      || '',
          environment: s.environment || '',
          style:       [s.style, raw.globalStyle].filter(Boolean).join(', '),
          cameraAngle: s.cameraAngle || '',
          lighting:    s.lighting    || '',
          mood:        s.mood        || '',
          detail:      s.detail      || '',
        };

        const positivePrompt = [
          components.subject,
          components.action,
          components.environment,
          components.cameraAngle,
          components.lighting,
          components.mood,
          components.detail,
          components.style,
        ].filter(Boolean).join(', ');

        const coherenceGroup = Number(s.coherenceGroup ?? 1);
        const seed = (masterSeed + (sceneIndex * 9973) + (coherenceGroup * 104729)) >>> 0;

        return {
          sceneIndex,
          sceneId,
          components,
          positivePrompt,
          negativeOverrides: Array.isArray(s.negativeOverrides) ? s.negativeOverrides : [],
          cameraMotion: (s.cameraMotion as CameraMotion) || 'ken_burns',
          durationSeconds: Number(s.durationSeconds) || 5.0,
          coherenceGroup,
          seed,
          metadata: {
            act:           Number(s.act) || 1,
            chapterTitle:  s.chapterTitle || '',
            sceneName:     s.sceneName || `Scene ${sceneIndex + 1}`,
            emotionalBeat: s.emotionalBeat || '',
          },
        };
      });

    return {
      jobId,
      masterSeed,
      totalScenes: scenes.length,
      scenes,
      globalStyle: raw.globalStyle || 'photorealistic, cinematic, 8K',
      globalCharacterAnchor,
      globalNegativeOverrides: Array.isArray(raw.globalNegativeOverrides)
        ? raw.globalNegativeOverrides
        : [],
      ffmpegPolicy: {
        targetFps:     Number(raw.ffmpegPolicy?.targetFps)    || 24,
        targetWidth:   Number(raw.ffmpegPolicy?.targetWidth)   || 1920,
        targetHeight:  Number(raw.ffmpegPolicy?.targetHeight)  || 1080,
        targetCodec:   'libx264',
        targetCrf:     Number(raw.ffmpegPolicy?.targetCrf)     || 18,
        defaultMotion: (raw.ffmpegPolicy?.defaultMotion as CameraMotion) || 'ken_burns',
      },
    };
  }

  private async _persistJob(
    payload: HydrationPayload,
    rawIntent: string,
    sessionId?: string,
  ): Promise<void> {
    try {
      await db.insert(videoJobs).values({
        id:                   payload.jobId,
        sessionId:            sessionId ?? null,
        rawIntent,
        masterSeed:           payload.masterSeed,
        totalScenes:          payload.totalScenes,
        globalStyle:          payload.globalStyle,
        globalCharacterAnchor: payload.globalCharacterAnchor || null,
        ffmpegPolicy:         payload.ffmpegPolicy as any,
        status:               'hydrated',
      }).onConflictDoUpdate({
        target: videoJobs.id,
        set: {
          status:               'hydrated',
          globalStyle:          payload.globalStyle,
          globalCharacterAnchor: payload.globalCharacterAnchor || null,
        },
      });

      for (const scene of payload.scenes) {
        await db.insert(videoScenes).values({
          id:               `${payload.jobId}_s${scene.sceneIndex}`,
          jobId:            payload.jobId,
          sceneIndex:       scene.sceneIndex,
          sceneId:          scene.sceneId,
          positivePrompt:   scene.positivePrompt,
          components:       scene.components as any,
          negativeOverrides: scene.negativeOverrides,
          cameraMotion:     scene.cameraMotion,
          durationSeconds:  String(scene.durationSeconds),
          coherenceGroup:   scene.coherenceGroup,
          seed:             scene.seed,
          metadata:         scene.metadata as any,
          status:           'pending',
        }).onConflictDoUpdate({
          target: videoScenes.id,
          set: { status: 'pending' },
        });
      }

      console.log(`[Hydration] Job ${payload.jobId} persisted to DB (${payload.scenes.length} scenes).`);
    } catch (err) {
      console.warn('[Hydration] DB persist warning:', err);
    }
  }

  private async _loadExistingJob(jobId: string): Promise<HydrationPayload | null> {
    try {
      const jobs = await db.select().from(videoJobs).where(eq(videoJobs.id, jobId));
      if (!jobs.length) return null;

      const job = jobs[0];
      const scenes = await db.select().from(videoScenes).where(eq(videoScenes.jobId, jobId));
      if (!scenes.length) return null;

      const restoredAnchor = job.globalCharacterAnchor ?? '';
      if (!restoredAnchor) {
        console.warn(
          `[Hydration] ⚠️ Job ${jobId} has no globalCharacterAnchor in DB — ` +
          `character consistency across frames cannot be guaranteed for this resumed job.`,
        );
      } else {
        console.log(`[Hydration] ✓ Restored globalCharacterAnchor for job ${jobId} (${restoredAnchor.length} chars).`);
      }

      return {
        jobId: job.id,
        masterSeed: job.masterSeed,
        totalScenes: job.totalScenes,
        globalStyle: job.globalStyle,
        globalCharacterAnchor: restoredAnchor,
        globalNegativeOverrides: [],
        ffmpegPolicy: job.ffmpegPolicy as any,
        scenes: (scenes as Array<typeof scenes[0]>)
          .sort((a, b) => (a.sceneIndex as number) - (b.sceneIndex as number))
          .map((s): HydratedScene => ({
            sceneIndex:        s.sceneIndex,
            sceneId:           s.sceneId,
            components:        s.components as SceneComponent,
            positivePrompt:    s.positivePrompt,
            negativeOverrides: s.negativeOverrides as string[],
            cameraMotion:      s.cameraMotion as CameraMotion,
            durationSeconds:   Number(s.durationSeconds),
            coherenceGroup:    s.coherenceGroup,
            seed:              s.seed,
            metadata:          s.metadata as any,
          })),
      };
    } catch {
      return null;
    }
  }
}

/**
 * Convenience export: build all scene prompts from a HydrationPayload.
 * Drop-in replacement for generateScenePrompts() in routes.ts.
 * Returns parallel arrays: positives[], negatives[], seeds[]
 */
export function hydratedPayloadToPromptArrays(
  payload: HydrationPayload,
): { positives: string[]; negatives: string[]; seeds: number[] } {
  const positives: string[] = [];
  const negatives: string[] = [];
  const seeds: number[] = [];

  for (const scene of payload.scenes) {
    // STEP 3 RESCUE: Do NOT prepend globalCharacterAnchor here.
    // Anchor injection is exclusively handled by video-prompt-engine.ts
    // (generateCoherentPrompt, position 7 in the semantic-break sequence).
    // Injecting it in both places caused "Latent Lock" — the model saw
    // the character description twice, saturating cross-attention and
    // bleeding subject tokens into every scene's background.
    positives.push(scene.positivePrompt);
    const sceneMergedNegative = [
      ...payload.globalNegativeOverrides,
      ...scene.negativeOverrides,
    ].join(', ');
    negatives.push(sceneMergedNegative);
    seeds.push(scene.seed);
  }

  return { positives, negatives, seeds };
}
