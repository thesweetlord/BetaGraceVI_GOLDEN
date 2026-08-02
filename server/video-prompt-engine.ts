/**
 * BetaGrace vI Video Prompt Engine
 *
 * The "secret sauce" for temporal coherence in latent diffusion video generation.
 *
 * Core philosophy (Gemini 3.1 / document insight):
 *   Diffusion models are stateless — each frame starts from fresh noise with zero
 *   memory of the previous image. The only "memory" we can give them is:
 *     1. Hyper-consistent positive prompts (same subject/environment/style every frame)
 *     2. Comprehensive negative prompts (explicit suppression of hallucination artifacts)
 *     3. Smooth seed drift through the latent space (prime multiplier, not chunked jumps)
 *     4. Image-to-image anchoring (feed the previous frame back as the starting point)
 *
 * Usage:
 *   import { promptStringToComponent, generateCoherentPrompt } from './video-prompt-engine.js';
 *   const component = promptStringToComponent(sceneString);
 *   const { positive, negative } = generateCoherentPrompt({ frameIndex: i, totalFrames: n, sceneComponents: component });
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface SceneComponent {
  subject?: string;
  action?: string;
  environment?: string;
  style?: string;
  cameraAngle?: string;
  lighting?: string;
  mood?: string;
  detail?: string;
}

export interface FrameContext {
  frameIndex: number;
  totalFrames: number;
  sceneComponents: SceneComponent;
  globalCharacterAnchor?: string;
  evolvingActions?: string[];
  negativePrompts?: string[];
}

// ── Positive anatomy reinforcement ────────────────────────────────────────
export const POSITIVE_ANATOMY_REINFORCEMENT =
  'flawless human anatomy, perfect proportions, highly detailed face, symmetrical eyes, five perfect fingers, masterpiece composition';

// ── Negative prompt library ────────────────────────────────────────────────

/**
 * The base negative prompt set used on every single frame.
 * These are the most common hallucination triggers in Flux/latent diffusion models.
 * WISDOM: Be religious about negative prompts — they are the primary guardrail
 * against temporal drift and visual artifacts.
 */
export const BASE_NEGATIVE_PROMPTS: string[] = [
  // ── Anatomy & body deformation ──────────────────────────────────────────
  'blurry', 'deformed', 'ugly', 'disfigured', 'bad anatomy',
  'missing limbs', 'extra limbs', 'mutated hands', 'bad eyes',
  'malformed face', 'fused fingers', 'extra fingers', 'missing fingers',
  'floating limbs', 'disconnected limbs', 'extra arms', 'extra legs',
  'deformed feet', 'malformed hands', 'poorly drawn hands', 'poorly drawn face',
  'long neck', 'elongated body', 'mutated body', 'body horror',
  'asymmetric face', 'crossed eyes', 'lazy eye', 'blank eyes', 'dead eyes',
  'open mouth horror', 'too many teeth', 'deformed ears', 'misshapen head',
  'giant head', 'tiny head', 'melting face', 'melting body',
  'conjoined', 'fused bodies', 'multiple heads', 'multiple faces',

  // ── Text, UI & watermarks ────────────────────────────────────────────────
  'text', 'watermark', 'signature', 'caption', 'subtitle', 'label',
  'logo', 'copyright', 'brand name', 'username', 'twitter handle',
  'url', 'website', 'font', 'lettering', 'words', 'numbers',
  'date stamp', 'timestamp', 'film grain overlay', 'UI elements',
  'interface', 'hud', 'menu', 'button', 'icon', 'border',
  'frame border', 'vignette overlay', 'lens flare text',

  // ── Quality & compression artifacts ─────────────────────────────────────
  'low contrast', 'grainy', 'noise', 'jpeg artifacts', 'low quality',
  'pixelated', 'oversaturated', 'washed out', 'overexposed', 'underexposed',
  'blotchy', 'smeared', 'smudged', 'muddy colors', 'color banding',
  'aliasing', 'jagged edges', 'compression artifacts', 'digital noise',
  'chromatic aberration', 'lens distortion', 'barrel distortion',
  'fish eye distortion', 'vignette', 'halftone', 'dithering',
  'posterized', 'solarized', 'color clipping', 'blown highlights',
  'crushed blacks', 'flat image', 'desaturated', 'monochrome bleed',

  // ── Composition & framing instability ───────────────────────────────────
  'out of frame', 'cropped', 'tilted horizon', 'disjointed', 'fragmented',
  'duplicate', 'cloned', 'split image', 'collage', 'multiple panels',
  'tiling', 'repeated pattern', 'mirror artifact', 'double exposure',
  'bad composition', 'unbalanced composition', 'cluttered', 'chaotic',
  'floating objects', 'wrong perspective', 'inconsistent scale',
  'cut off head', 'cut off body', 'partial figure', 'amputated',
  'figure at edge', 'subject off center badly', 'extreme dutch angle',

  // ── Style drift (prevent cartoon / illustration mode-collapse) ───────────
  'cartoon', 'anime', 'illustration', 'painting', 'drawing', 'sketch',
  'flat shading', 'cel shading', 'comic book', '2D', '3D render',
  'CGI', 'video game graphic', 'low poly', 'toon shading',
  'manga', 'chibi', 'pixel art', 'vector art', 'clip art',
  'concept art', 'storyboard style', 'rough draft', 'outline only',
  'line art', 'pencil sketch', 'pen drawing', 'ink drawing',
  'watercolor wash', 'oil painting style', 'acrylic painting',
  'impressionist', 'cubist', 'abstract', 'surrealist distortion',
  'pop art', 'collage art', 'digital painting', 'matte painting look',

  // ── Lighting & color problems ────────────────────────────────────────────
  'foggy', 'haze', 'artifacts', 'glitch', 'static', 'distortion',
  'unnatural lighting', 'neon color cast', 'wrong skin tone',
  'purple fringing', 'green cast', 'yellow cast', 'color fringing',
  'flat lighting', 'no shadows', 'shadow artifacts', 'inconsistent shadows',
  'multiple light sources conflicting', 'blown out sky', 'nuclear sunset',
  'fake HDR', 'over-sharpened', 'unsharp mask artifacts',

  // ── Temporal coherence breakers (specific to video generation) ───────────
  'style change between frames', 'inconsistent character appearance',
  'teleporting subject', 'warping background', 'flickering',
  'color shift', 'subject morphing', 'object popping', 'scene jump',
  'inconsistent time of day', 'inconsistent weather', 'background swap',
  'clothing change', 'hair color change', 'age change',

  // ── Scene / environment quality ──────────────────────────────────────────
  'empty void background', 'plain white background', 'plain grey background',
  'studio backdrop visible', 'green screen', 'chroma key',
  'unrealistic environment', 'floating ground', 'missing ground',
  'sky on ground', 'wrong gravity', 'inverted shadows',
];

// ── Core functions ─────────────────────────────────────────────────────────

/**
 * Converts a plain-text scene prompt string into a SceneComponent.
 * The full string is placed in `environment` — the FIRST slot in the
 * rescue-plan prompt sequence — so the scene content is always rendered
 * by the diffusion model before the character anchor is processed.
 *
 * CRITICAL: Do NOT map to `subject`. The rescue-plan sequence removed
 * `subject` from the positive output to cure Latent Lock. Mapping to
 * `subject` silently drops the entire scene text and causes the model
 * to generate from POSITIVE_ANATOMY_REINFORCEMENT alone (women with hands).
 */
export function promptStringToComponent(prompt: string): SceneComponent {
  return { environment: prompt.trim() };
}

/**
 * Builds the final (positive, negative) prompt pair for a single frame.
 *
 * Key behaviours:
 *  - Fixed components (subject, environment, style) appear on EVERY frame for consistency
 *  - Evolving actions interpolate across the scene's frame span for gradual motion
 *  - Negative prompts merge BASE_NEGATIVE_PROMPTS with any scene-specific overrides
 */
export function generateCoherentPrompt(context: FrameContext): {
  positive: string;
  negative: string;
} {
  const {
    frameIndex,
    totalFrames,
    sceneComponents,
    globalCharacterAnchor,
    evolvingActions = [],
    negativePrompts = [],
  } = context;

  // ── STEP 1 RESCUE: Environment-first prompt sequence ───────────────────
  // Force the diffusion model to render the environment BEFORE the character.
  // The "---" literal forces a semantic break in the cross-attention layers,
  // decoupling the environment latent space from the character anchor.
  // Order is EXACT as specified to cure "Latent Lock" and "Attention Saturation".

  const envParts: string[] = [
    sceneComponents.environment,
    sceneComponents.action,
    sceneComponents.cameraAngle,
    sceneComponents.lighting,
    sceneComponents.detail,
  ].filter((v): v is string => Boolean(v));

  // ── Evolving action progression (gradual, not abrupt) ─────────────────
  // Inserted into the environment block (before the semantic break) so
  // motion description stays coupled to the scene, not the character.
  if (evolvingActions.length > 0) {
    const ratio = frameIndex / Math.max(1, totalFrames - 1);
    const actionIndex = Math.min(
      Math.floor(ratio * evolvingActions.length),
      evolvingActions.length - 1,
    );
    envParts.push(evolvingActions[actionIndex]);
  }

  // Semantic break — forces cross-attention to reset between env and character
  const semanticBreak = '---';

  // Character anchor block (position 7) — only injected here, not in hydration
  const characterParts: string[] = [];
  if (globalCharacterAnchor) characterParts.push(globalCharacterAnchor);

  // Style block (position 8) — overlay, not subject
  const styleParts: string[] = [];
  if (sceneComponents.style) styleParts.push(sceneComponents.style);

  // Assemble: env → semantic break → character anchor → style → anatomy
  const positive = [
    ...envParts,
    semanticBreak,
    ...characterParts,
    ...styleParts,
    POSITIVE_ANATOMY_REINFORCEMENT,
  ].filter(Boolean).join(', ');

  // ── Merge base negatives with any scene-specific overrides ───────────
  const negative = [
    ...new Set([
      ...BASE_NEGATIVE_PROMPTS,
      ...negativePrompts,
    ]),
  ].join(', ');

  return { positive, negative };
}

/**
 * Compute the seed for a specific frame using prime-multiplied drift.
 *
 * WISDOM (from Gemini 3.1 analysis): multiplying frameIndex by a small prime
 * creates a smooth, non-repeating walk through the latent space. The old
 * approach of changing seeds in 12-frame chunks caused visible visual jumps
 * at every chunk boundary. Per-frame prime drift is more continuous.
 */
export function computeFrameSeed(masterSeed: number, frameIndex: number): number {
  void frameIndex; // seed is locked — variation is driven by evolving text descriptions
  return masterSeed >>> 0; // >>> 0 keeps it a 32-bit unsigned int
}
