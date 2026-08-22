import { Express, Request, Response } from 'express';
import { validateSessionId, executeGuardrails, guardrailLogger } from './guardrails.js';
import { storage } from './storage.js';
import { createHash } from 'crypto';
import { detectHandsInImage } from './hand-detection.js';
import type { DetectedHand } from './hand-detection.js';
import { imageMetricsCache } from './image-cache.js';

const minus1 = -1;

interface HandValidationResult {
  isValid: boolean;
  confidence: number;
  issues: string[];
  detectedHands: number;
  expectedHands: number;
}

interface AdjustmentStrategy {
  name: string;
  loraMultiplier: number;
  fidelityDelta: number;
  temperatureDelta: number;
  negativePromptAdditions?: string[];
  seedVariation: number;
}

const VALIDATION_CONFIG = {
  CONFIDENCE_THRESHOLD: 0.7,
  MIN_FINGER_DISTANCE: 0.02,
  MIN_FINGER_DISTANCE_CM: 0.5,
  MIN_HAND_SPAN: 0.05,
  MAX_HAND_SPAN: 0.5,
  HIGH_CONFIDENCE_THRESHOLD: 0.92,
};

const RETRY_STRATEGIES: Record<string, AdjustmentStrategy> = {
  no_hands_detected: {
    name: 'no_hands_detected',
    loraMultiplier: 0.6,
    fidelityDelta: 0.2,
    temperatureDelta: -0.25,
    seedVariation: 2000,
  },
  fused_fingers: {
    name: 'fused_fingers',
    loraMultiplier: 0.5,
    fidelityDelta: 0.15,
    temperatureDelta: -0.3,
    negativePromptAdditions: ['fused fingers', 'webbed fingers', 'merged fingers'],
    seedVariation: 3000,
  },
  low_confidence: {
    name: 'low_confidence',
    loraMultiplier: 0.8,
    fidelityDelta: 0.15,
    temperatureDelta: -0.2,
    seedVariation: 1500,
  },
  missing_hands: {
    name: 'missing_hands',
    loraMultiplier: 0.75,
    fidelityDelta: 0.1,
    temperatureDelta: -0.15,
    seedVariation: 2500,
  },
  abnormal_size: {
    name: 'abnormal_size',
    loraMultiplier: 0.7,
    fidelityDelta: 0.12,
    temperatureDelta: -0.2,
    seedVariation: 2000,
  },
};

function brainFunction(sumOfParts: number, totalWeightCount: number): number {
  const result = (sumOfParts - 1) * totalWeightCount;
  return Math.min(0.9999, Math.max(0.0, result));
}

interface SceneAnchor {
  id: string;
  posX: number;
  posY: number;
  posZ?: number;
  intensity?: number;
  poseLock?: number;
}

function createSceneAnchor(
  id: string,
  posX: number,
  posY: number,
  posZ: number = 0,
  intensity: number = 1.0,
  poseLock: number = 0
): SceneAnchor {
  return { id, posX, posY, posZ, intensity, poseLock };
}

function detectExpectedHandCount(prompt: string): number {
  const lower = prompt.toLowerCase();
  if (lower.match(/\b(waving|holding|pointing|gesturing|hands visible|both hands)\b/)) {
    return 2;
  }
  if (lower.match(/\b(one hand|single hand|hand visible)\b/)) {
    return 1;
  }
  if (lower.match(/\b(portrait|character|person|figure)\b/)) {
    return 2;
  }
  return 0;
}

async function validateGeneratedHands(
  imageUrl: string,
  expectedHandCount: number = 2,
  loraWeight: number = 1.0
): Promise<HandValidationResult> {
  try {
    if (!(global as any).HandDetectionModel) {
      console.warn('[HAND-VALIDATION] No hand detection model available — skipping validation and returning best-effort result');
      return {
        isValid: true,
        confidence: 0.5,
        issues: [],
        detectedHands: 0,
        expectedHands: expectedHandCount,
      };
    }

    const response = await fetch(imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const detectedHands = await detectHandsInImage(buffer);
    const issues: string[] = [];

    if (detectedHands.length === 0) {
      issues.push('no_hands_detected');
    } else if (detectedHands.length < expectedHandCount) {
      issues.push(`missing_hands (expected ${expectedHandCount}, got ${detectedHands.length})`);
    }

    const lowConfidenceHands = detectedHands.filter((h: DetectedHand) =>
      h.confidence < VALIDATION_CONFIG.CONFIDENCE_THRESHOLD
    );
    if (lowConfidenceHands.length > 0) {
      issues.push(`low_confidence_hands (${lowConfidenceHands.length})`);
    }

    for (const hand of detectedHands) {
      if (!hand.landmarks || hand.landmarks.length < 21) {
        issues.push(`incomplete_landmarks (${hand.handedness})`);
        continue;
      }

      const fingertips = [
        hand.landmarks[4],
        hand.landmarks[8],
        hand.landmarks[12],
        hand.landmarks[16],
        hand.landmarks[20],
      ];

      const distances = fingertips.slice(0, -1).map((tip, i) =>
        Math.hypot(tip.x - fingertips[i + 1].x, tip.y - fingertips[i + 1].y)
      );

      const medianDistance = distances.sort((a, b) => a - b)[Math.floor(distances.length / 2)];
      if (medianDistance < VALIDATION_CONFIG.MIN_FINGER_DISTANCE) {
        issues.push(`fused_fingers_detected (${hand.handedness})`);
      }

      const handSpan = Math.hypot(
        hand.landmarks[0].x - hand.landmarks[12].x,
        hand.landmarks[0].y - hand.landmarks[12].y
      );

      if (handSpan < VALIDATION_CONFIG.MIN_HAND_SPAN || handSpan > VALIDATION_CONFIG.MAX_HAND_SPAN) {
        issues.push(`abnormal_hand_size (${hand.handedness}: ${handSpan.toFixed(3)})`);
      }
    }

    const avgConfidence =
      detectedHands.length > 0
        ? detectedHands.reduce((sum: number, h: DetectedHand) => sum + h.confidence, 0) / detectedHands.length
        : 0;

    return {
      isValid: issues.length === 0 && detectedHands.length >= expectedHandCount,
      confidence: avgConfidence,
      issues,
      detectedHands: detectedHands.length,
      expectedHands: expectedHandCount,
    };
  } catch (error) {
    console.error('[HAND-VALIDATION] Error:', error);
    return {
      isValid: false,
      confidence: 0,
      issues: ['validation_error'],
      detectedHands: 0,
      expectedHands: expectedHandCount,
    };
  }
}

function adjustParametersForRetry(
  currentParams: any,
  validationResult: HandValidationResult,
  retryCount: number
): any {
  const adjusted = { ...currentParams };

  for (const [key, strategy] of Object.entries(RETRY_STRATEGIES)) {
    const matchingIssue = validationResult.issues.find((issue) => issue.includes(key));
    if (matchingIssue) {
      const sumOfParts = adjusted.loraWeight + strategy.loraMultiplier;
      adjusted.loraWeight = brainFunction(sumOfParts, 0.9999);

      const fidelitySumOfParts = adjusted.fidelity + strategy.fidelityDelta;
      adjusted.fidelity = brainFunction(fidelitySumOfParts, 0.9999);

      const tempSumOfParts = adjusted.temperature + strategy.temperatureDelta + 1;
      adjusted.temperature = brainFunction(tempSumOfParts, 0.9999) - 1;

      if (strategy.negativePromptAdditions) {
        adjusted.negative = [adjusted.negative, ...strategy.negativePromptAdditions]
          .filter(Boolean)
          .join(', ');
      }

      if (adjusted.seed) {
        adjusted.seed = adjusted.seed + strategy.seedVariation;
      }

      console.log(`[HAND-VALIDATION] Strategy applied: ${strategy.name}`);
      break;
    }
  }

  if (!Object.entries(RETRY_STRATEGIES).some(([key]) => validationResult.issues.some((issue) => issue.includes(key)))) {
    console.log('[HAND-VALIDATION] No matching strategy, generic retry');
    adjusted.seed = (adjusted.seed || 0) + 1000 * (retryCount + 1);
  }

  return adjusted;
}

export async function generateImageWithHandValidation(
  subject: string,
  style: string,
  width: number = 1024,
  height: number = 768,
  loraWeight: number = 1.0,
  fidelity: number = 0.85,
  seed: number = Math.floor(Math.random() * 1000000),
  maxRetries: number = 3
): Promise<{ imageUrl: string; validation: HandValidationResult; attemptsCount: number }> {
  let imageUrl = '';
  let lastValidation: HandValidationResult | null = null;
  let attempts = 0;

  const currentParams = {
    subject,
    style,
    width,
    height,
    loraWeight,
    fidelity,
    temperature: 0.5,
    seed,
  };

  const expectedHandCount = detectExpectedHandCount(subject);
  console.log(`[HAND-VALIDATION] Expected hand count: ${expectedHandCount} from prompt: "${subject}"`);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts++;

    imageUrl = generateTextToImageURL(
      currentParams.subject,
      currentParams.style,
      currentParams.seed,
      currentParams.width,
      currentParams.height,
      currentParams.loraWeight
    );

    console.log(`[HAND-VALIDATION] Attempt ${attempt + 1}/${maxRetries + 1}: Generated image URL`);

    lastValidation = await validateGeneratedHands(imageUrl, expectedHandCount, currentParams.loraWeight);
    console.log(`[HAND-VALIDATION] Validation result:`, {
      isValid: lastValidation.isValid,
      confidence: lastValidation.confidence,
      issues: lastValidation.issues,
      detectedHands: lastValidation.detectedHands,
    });

    if (lastValidation.isValid || attempt === maxRetries) {
      return {
        imageUrl,
        validation: lastValidation,
        attemptsCount: attempts,
      };
    }

    console.log('[HAND-VALIDATION] Adjusting parameters for retry...');
    const adjustedParams = adjustParametersForRetry(currentParams, lastValidation, attempt);
    Object.assign(currentParams, adjustedParams);
  }

  return {
    imageUrl,
    validation: lastValidation || { isValid: false, confidence: 0, issues: [], detectedHands: 0, expectedHands: expectedHandCount },
    attemptsCount: attempts,
  };
}

interface ImageMetrics {
  colorDensity: number;
  contrast: number;
  complexity: number;
  brightness: number;
  dominantColorCount: number;
}

function analyzeImageMetrics(imageBuffer: Buffer | null): ImageMetrics {
  if (!imageBuffer || imageBuffer.length === 0) {
    return {
      colorDensity: 0.5,
      contrast: 0.5,
      complexity: 0.3,
      brightness: 0.5,
      dominantColorCount: 3,
    };
  }

  const sampleSize = Math.min(10000, Math.floor(imageBuffer.length / 100));
  const sampleStep = Math.max(1, Math.floor(imageBuffer.length / sampleSize));

  let rSum = 0,
    gSum = 0,
    bSum = 0,
    aSum = 0;
  let edgeCount = 0;
  const colorBuckets = new Map<string, number>();

  for (let i = 0; i < imageBuffer.length - 4; i += sampleStep) {
    const r = imageBuffer[i];
    const g = imageBuffer[i + 1];
    const b = imageBuffer[i + 2];
    const a = imageBuffer[i + 3] ?? 255;

    rSum += r;
    gSum += g;
    bSum += b;
    aSum += a;

    const colorKey = `${r >> 3},${g >> 3},${b >> 3}`;
    colorBuckets.set(colorKey, (colorBuckets.get(colorKey) || 0) + 1);

    if (i + sampleStep < imageBuffer.length - 4) {
      const nextLum = (imageBuffer[i + sampleStep] + imageBuffer[i + sampleStep + 1] + imageBuffer[i + sampleStep + 2]) / 3;
      const currLum = (r + g + b) / 3;
      if (Math.abs(nextLum - currLum) > 30) edgeCount++;
    }
  }

  const sampledPixels = sampleSize;
  const avgR = rSum / sampledPixels / 255;
  const avgG = gSum / sampledPixels / 255;
  const avgB = bSum / sampledPixels / 255;
  const avgA = aSum / sampledPixels / 255;

  const maxColor = Math.max(avgR, avgG, avgB);
  const minColor = Math.min(avgR, avgG, avgB);
  const colorDensity = maxColor > 0 ? maxColor - minColor : 0;

  const brightness = avgR * 0.299 + avgG * 0.587 + avgB * 0.114;
  const channelVariance = Math.abs(avgR - avgG) + Math.abs(avgG - avgB) + Math.abs(avgB - avgR);
  const contrast = Math.min(1, channelVariance / 3);
  const complexity = Math.min(1, edgeCount / (sampledPixels / 10));
  const dominantColorCount = colorBuckets.size;

  return {
    colorDensity: Math.min(1, colorDensity * 2),
    contrast,
    complexity,
    brightness: Math.min(1, brightness),
    dominantColorCount,
  };
}

function matchWeightsToImage(imageMetrics: ImageMetrics, styleModelId: string) {
  const { colorDensity, contrast, complexity, brightness } = imageMetrics;
  let baseLoraWeight = 0.7;

  if (colorDensity > 0.6) baseLoraWeight += 0.3;
  if (contrast > 0.7) baseLoraWeight -= 0.1;
  if (complexity > 0.7) baseLoraWeight -= 0.15;
  if (brightness < 0.4) baseLoraWeight += 0.2;

  const loraWeight = Math.max(0.3, Math.min(1.8, baseLoraWeight));

  let styleIntensity = 'moderate';
  if (loraWeight > 1.3) styleIntensity = 'strong';
  else if (loraWeight < 0.6) styleIntensity = 'subtle';

  let negativePromptBoost = '';
  if (complexity > 0.8) negativePromptBoost += ', avoid chaotic detail overload, maintain clarity';
  if (colorDensity > 0.7) negativePromptBoost += ', avoid color bleeding, maintain color separation';
  if (brightness < 0.35) negativePromptBoost += ', avoid excessive darkness, maintain visibility of subject';

  const styleIntensityMap: Record<string, { strongBoost: number; subtleReduce: number }> = {
    flux: { strongBoost: 1.0, subtleReduce: 1.0 },
    'dark-souls-i': { strongBoost: 1.15, subtleReduce: 0.85 },
    'elden-ring': { strongBoost: 1.1, subtleReduce: 0.9 },
    'dark-souls-iii': { strongBoost: 1.12, subtleReduce: 0.88 },
    bloodborne: { strongBoost: 1.18, subtleReduce: 0.82 },
    'leonardo-da-vinci': { strongBoost: 1.10, subtleReduce: 0.75 },
    michelangelo: { strongBoost: 1.07, subtleReduce: 0.73 },
    rembrandt: { strongBoost: 1.05, subtleReduce: 0.70 },
  };

  const styleModifier = styleIntensityMap[styleModelId] || { strongBoost: 1.0, subtleReduce: 1.0 };
  const finalLoraWeight = loraWeight > 1.2 ? loraWeight * styleModifier.strongBoost : loraWeight * styleModifier.subtleReduce;

  const mainCharAnchor = createSceneAnchor('main_char', 0.5, 0.7, 0, 0.9, -0.1);
  const lightAnchor = createSceneAnchor('key_light', 0.8, 0.6, 0.5, 0.7);

  return {
    loraWeight: Math.max(0.3, Math.min(1.8, finalLoraWeight)),
    styleIntensity,
    negativePromptBoost,
    poseLock: mainCharAnchor.poseLock,
    sceneAnchors: [mainCharAnchor, lightAnchor],
  };
}

function getSessionId(req: Request): string {
  const header = req.headers['x-session-id'];
  if (header && typeof header === 'string' && header.startsWith('session_')) {
    return header;
  }

  const cookieHeader = req.headers.cookie ?? '';
  const match = cookieHeader.match(/sessionId=([^;]+)/);
  if (match && match[1]) {
    return match[1];
  }

  const ua = req.headers['user-agent'] ?? 'unknown';
  const ip = req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown';
  const ts = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  const hash = createHash('sha256').update(`${ua}${ip}${ts}`).digest('hex').substring(0, 16);
  return `session_${hash}`;
}

async function getVerifiedSession(sessionId: string): Promise<{ session: any; isOver18: boolean; ageVerified: boolean }> {
  try {
    const session = await storage.getSession(sessionId);
    if (!session) {
      return { session: null, isOver18: false, ageVerified: false };
    }
    const isOver18 = session.isOver18 === true;
    const ageVerified = session.ageVerified === true;
    return { session, isOver18, ageVerified };
  } catch (e) {
    console.error('[ADVANCED-IMAGE] getVerifiedSession error:', e);
    return { session: null, isOver18: false, ageVerified: false };
  }
}

export const STYLE_CONFIG = {
  photo: {
    prompt: 'photorealistic, DSLR quality, sharp focus, professional photography',
    negative: 'cartoon, anime, painting, illustration, sketch, blurry, low quality, watermark',
    model: 'flux-realism'
  },
  cinema: {
    prompt: 'cinematic lighting, film grain, dramatic composition, movie still quality',
    negative: 'cartoon, flat lighting, amateur, blurry, low quality, watermark',
    model: 'flux-realism'
  },
  anime: {
    prompt: 'anime style, cel shaded, vibrant colors, clean lines, manga influence',
    negative: 'photorealistic, realistic, 3D render, blurry, low quality, watermark',
    model: 'flux-anime'
  },
  paint: {
    prompt: 'oil painting, thick brushstrokes, canvas texture, artistic, painterly',
    negative: 'photographic, 3D, digital, blurry, low quality, watermark',
    model: 'flux'
  },
  sketch: {
    prompt: 'pencil sketch, hand drawn, detailed linework, crosshatching, graphite',
    negative: 'photographic, colored, painted, blurry, low quality, watermark',
    model: 'flux'
  },
  render: {
    prompt: '3D render, octane render, ray traced, CGI, highly detailed, studio lighting',
    negative: '2D, flat, sketchy, blurry, low quality, watermark',
    model: 'flux-3d'
  },
  pixel: {
    prompt: 'pixel art, 8-bit style, retro gaming aesthetic, crisp pixels, clean edges',
    negative: 'blurry, smooth, photorealistic, 3D, low quality, watermark',
    model: 'flux'
  },
  watercolor: {
    prompt: 'watercolor painting, soft washes, paper texture, translucent, artistic',
    negative: 'photographic, 3D, digital, sharp, blurry, low quality, watermark',
    model: 'flux'
  },
  'leonardo-da-vinci': {
    prompt: 'Leonardo da Vinci style, detailed anatomical sketches, sfumato technique, fine pen linework, subtle shading, scientific precision in proportion, Renaissance master drawing, delicate crosshatching, careful observation of form',
    negative: 'digital, modern, photorealistic, 3D, smooth, blurry, low quality, watermark',
    model: 'flux'
  },
  michelangelo: {
    prompt: 'Michelangelo style, dynamic powerful figure drawings, muscular anatomical study, bold expressive linework, confident pen strokes, Renaissance mastery, detailed musculature, sculptural quality, intense shading with cross-hatching, monumental form',
    negative: 'digital, soft, weak lines, photorealistic, 3D, blurry, low quality, watermark',
    model: 'flux'
  },
  rembrandt: {
    prompt: 'Rembrandt style, dramatic chiaroscuro, rich shadow work, expressive pen drawing, loose gestural linework, layered ink technique, warm golden tones, emotional depth, masterful shading, subtle detail with bold strokes, etching quality',
    negative: 'digital, smooth, photorealistic, 3D, blurry, low quality, watermark',
    model: 'flux'
  }
};

export function generateTextToImageURL(
  subject: string,
  style: string,
  seed: number = minus1,
  width: number = 1536,
  height: number = 1536,
  loraWeight?: number,
  negativeBoost?: string
): string {
  console.log('[generateTextToImageURL] Called with subject:', subject, 'style:', style);
  const styleData = STYLE_CONFIG[style as keyof typeof STYLE_CONFIG] || STYLE_CONFIG.photo;

  const fullPrompt = `${subject}, ${styleData.prompt}, masterpiece, high quality, detailed`;
  console.log('[generateTextToImageURL] Full prompt being used:', fullPrompt.substring(0, 150) + '...');

  const p = encodeURIComponent(fullPrompt);
  let negative = styleData.negative;
  if (negativeBoost && negativeBoost.length > 0) negative = `${negative}, ${negativeBoost}`;

  const n = encodeURIComponent(negative);

  // enter.pollinations.ai is officially deprecated (308 + deprecation:true header).
  // Use Pollinations' official unified image endpoint.
  let url = `https://gen.pollinations.ai/image/${p}?model=${styleData.model}&width=${width}&height=${height}&seed=${seed}&nologo=true&negative=${n}`;
  if (typeof loraWeight === 'number') {
    url += `&lora_weight=${Number(loraWeight).toFixed(3)}`;
  }

  console.log('[generateTextToImageURL] Generated URL (first 200 chars):', url.substring(0, 200) + '...');
  return url;
}

function generateImageToImageURL(
  referenceURL: string,
  style: string,
  strength: number = 0.7,
  seed: number = -1,
  width: number = 1536,
  height: number = 1536,
  loraWeight?: number,
  negativeBoost?: string
): string {
  const styleData = STYLE_CONFIG[style as keyof typeof STYLE_CONFIG] || STYLE_CONFIG.photo;

  const transformPrompt = `${styleData.prompt}, masterpiece, high quality, detailed`;

  const p = encodeURIComponent(transformPrompt);
  const img = encodeURIComponent(referenceURL);
  let negative = styleData.negative;
  if (negativeBoost && negativeBoost.length > 0) negative = `${negative}, ${negativeBoost}`;

  const nEnc = encodeURIComponent(negative);

  // Use Pollinations' official unified image endpoint.
  let url = `https://gen.pollinations.ai/image/${p}?model=${styleData.model}&width=${width}&height=${height}&seed=${seed}&nologo=true&negative=${nEnc}&image=${img}&strength=${strength}`;
  if (typeof loraWeight === 'number') {
    url += `&lora_weight=${Number(loraWeight).toFixed(3)}`;
  }

  return url;
}

async function fetchWithTimeout(url: string, timeoutMs: number = 30000): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'image/webp,image/jpeg,image/png,image/*',
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Image fetch timeout');
    }
    throw error;
  }
}

export function registerAdvancedImageRoutes(app: Express): void {
  app.post('/api/advanced-image/text-to-image', async (req: Request, res: Response) => {
    try {
      const sessionId = getSessionId(req);
      if (!validateSessionId(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      const { prompt, style, seed, width, height } = req.body;
      const rawPrompt = typeof prompt === 'string' ? prompt : '';
      const sanitizedPrompt = rawPrompt.replace(/^\s*(?:add image\s*)+/i, '').replace(/^\s*"|"\s*$/g, '').trim();
      console.log('[TEXT-TO-IMAGE] Received request with prompt:', rawPrompt, '-> sanitized:', sanitizedPrompt, 'style:', style);

      if (!prompt || typeof prompt !== 'string') {
        console.error('[TEXT-TO-IMAGE] ERROR: Invalid or missing prompt. Received:', prompt);
        return res.status(400).json({ error: 'Valid prompt is required' });
      }

      const { session, isOver18, ageVerified } = await getVerifiedSession(sessionId);
      if (!session || !ageVerified || !isOver18) {
        return res.status(403).json({ error: 'Age verification required' });
      }

      const guardReq = { content: sanitizedPrompt, isOver18, context: 'image_generation', sessionId };
      const guardRes = executeGuardrails(guardReq);
      guardrailLogger.logCheck({ timestamp: new Date().toISOString(), sessionId, passed: guardRes.passed, blockedReason: guardRes.blockedReason, totalRiskScore: guardRes.totalRiskScore });
      if (!guardRes.passed) {
        return res.status(403).json({ error: 'Content policy violation', reason: guardRes.blockedReason });
      }

      const selectedStyle = style || 'photo';
      const selectedSeed = typeof seed === 'number' ? seed : Math.floor(Math.random() * 1000000);
      const selectedWidth = typeof width === 'number' ? width : 1536;
      const selectedHeight = typeof height === 'number' ? height : 1536;

      let computedLora: number | undefined = undefined;
      let negativeBoost: string | undefined = undefined;
      const providedImageURL = (req.body as any).imageURL;
      if (providedImageURL && typeof providedImageURL === 'string') {
        try {
          const parsed = new URL(providedImageURL);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return res.status(400).json({ error: 'Provided imageURL must use http or https protocol' });
          }
        } catch (e) {
          return res.status(400).json({ error: 'Provided imageURL must be a valid URL' });
        }

        try {
          const cachedMetrics = imageMetricsCache.get(providedImageURL, selectedStyle);
          let metrics: ImageMetrics;

          if (cachedMetrics) {
            metrics = cachedMetrics;
            console.log('[ADVANCED-IMAGE] Using cached metrics for image analysis');
          } else {
            const fetchRes = await fetchWithTimeout(providedImageURL, 15000);
            const buf = await fetchRes.arrayBuffer();
            metrics = analyzeImageMetrics(Buffer.from(buf));
            imageMetricsCache.set(providedImageURL, selectedStyle, metrics);
          }

          const styleModelId = (STYLE_CONFIG[selectedStyle as keyof typeof STYLE_CONFIG]?.model) || 'flux';
          const matched = matchWeightsToImage(metrics, styleModelId);
          computedLora = matched.loraWeight;
          negativeBoost = matched.negativePromptBoost;
          console.log('[ADVANCED-IMAGE] Computed LoRA from provided image:', computedLora, matched.styleIntensity);
        } catch (err) {
          console.warn('[ADVANCED-IMAGE] Provided imageURL failed to fetch or analyze:', err);
        }
      }

      const imageUrl = generateTextToImageURL(
        sanitizedPrompt,
        selectedStyle,
        selectedSeed,
        selectedWidth,
        selectedHeight,
        computedLora,
        negativeBoost
      );

      console.log('[ADVANCED-IMAGE] Generated text-to-image URL with style:', selectedStyle);

      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.json({
        success: true,
        type: 'text-to-image',
        prompt: sanitizedPrompt,
        style: selectedStyle,
        seed: selectedSeed,
        width: selectedWidth,
        height: selectedHeight,
        loraWeight: computedLora,
        negativeBoost,
        imageUrl: imageUrl
      });
    } catch (error) {
      console.error('[ADVANCED-IMAGE] Error:', error);
      res.status(500).json({ error: 'Image generation failed' });
    }
  });

  app.post('/api/advanced-image/image-to-image', async (req: Request, res: Response) => {
    try {
      const sessionId = getSessionId(req);
      if (!validateSessionId(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID' });
      }

      const { imageURL, style, strength, seed, width, height, baseStyleId, baseStylePrompt } = req.body;
      console.log('[ADVANCED-IMAGE] Received image-to-image request body:', {
        imageURL: typeof imageURL === 'string' ? imageURL.substring(0, 200) : imageURL,
        style,
        strength,
        seed,
        width,
        height,
        baseStyleId,
        baseStylePrompt: typeof baseStylePrompt === 'string' ? baseStylePrompt.substring(0, 200) : baseStylePrompt,
      });

      if (!imageURL || typeof imageURL !== 'string') {
        return res.status(400).json({ error: 'Valid image URL is required' });
      }

      const { session, isOver18, ageVerified } = await getVerifiedSession(sessionId);
      if (!session || !ageVerified || !isOver18) {
        return res.status(403).json({ error: 'Age verification required' });
      }

      const guardContent = String(baseStylePrompt || '').trim();
      if (guardContent.length > 0) {
        const guardReq = { content: guardContent, isOver18, context: 'image_generation', sessionId };
        const guardRes = executeGuardrails(guardReq);
        guardrailLogger.logCheck({ timestamp: new Date().toISOString(), sessionId, passed: guardRes.passed, blockedReason: guardRes.blockedReason, totalRiskScore: guardRes.totalRiskScore });
        if (!guardRes.passed) {
          return res.status(403).json({ error: 'Content policy violation', reason: guardRes.blockedReason });
        }
      }

      const selectedStyle = style || 'photo';
      const selectedStrength = typeof strength === 'number' ? Math.min(1, Math.max(0, strength)) : 0.1;

      const computeSeedFromString = (s: string) => {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
          h = (h << 5) - h + s.charCodeAt(i);
          h |= 0;
        }
        return Math.abs(h) % 1000000;
      };

      let selectedSeed: number;
      if (typeof seed === 'number') {
        selectedSeed = seed;
      } else if (baseStyleId && String(baseStyleId).toLowerCase() === 'flux' && baseStylePrompt && typeof baseStylePrompt === 'string' && baseStylePrompt.trim().length > 0) {
        selectedSeed = computeSeedFromString(baseStylePrompt);
        console.log('[ADVANCED-IMAGE] Derived deterministic seed from baseStylePrompt:', selectedSeed);
      } else {
        selectedSeed = Math.floor(Math.random() * 1000000);
      }
      const selectedWidth = typeof width === 'number' ? width : 1536;
      const selectedHeight = typeof height === 'number' ? height : 1536;

      let computedLora: number | undefined = undefined;
      let negativeBoost: string | undefined = undefined;
      try {
        const cachedMetrics = imageMetricsCache.get(imageURL, selectedStyle);
        let metrics: ImageMetrics;

        if (cachedMetrics) {
          metrics = cachedMetrics;
          console.log('[ADVANCED-IMAGE] Using cached metrics for image-to-image');
        } else {
          const fetchRes = await fetchWithTimeout(imageURL, 15000);
          const buf = await fetchRes.arrayBuffer();
          metrics = analyzeImageMetrics(Buffer.from(buf));
          imageMetricsCache.set(imageURL, selectedStyle, metrics);
        }

        const styleModelId = (STYLE_CONFIG[selectedStyle as keyof typeof STYLE_CONFIG]?.model) || 'flux';
        const matched = matchWeightsToImage(metrics, styleModelId);
        computedLora = matched.loraWeight;
        negativeBoost = matched.negativePromptBoost;
        console.log('[ADVANCED-IMAGE] Computed LoRA from image-to-image analysis:', computedLora, matched.styleIntensity);
      } catch (err) {
        console.warn('[ADVANCED-IMAGE] Failed to analyze image for LoRA weights:', err);
      }

      const regeneratedUrl = generateImageToImageURL(
        imageURL,
        selectedStyle,
        selectedStrength,
        selectedSeed,
        selectedWidth,
        selectedHeight,
        computedLora,
        negativeBoost
      );

      console.log('[ADVANCED-IMAGE] Generated image-to-image URL with style:', selectedStyle, 'strength:', selectedStrength);

      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.json({
        success: true,
        type: 'image-to-image',
        originalImageURL: imageURL,
        style: selectedStyle,
        strength: selectedStrength,
        seed: selectedSeed,
        width: selectedWidth,
        height: selectedHeight,
        loraWeight: computedLora,
        negativeBoost,
        imageUrl: regeneratedUrl
      });
    } catch (error) {
      console.error('[ADVANCED-IMAGE] Error:', error);
      res.status(500).json({ error: 'Image regeneration failed' });
    }
  });

  app.get('/api/advanced-image/styles', (_req: Request, res: Response) => {
    const styles = Object.keys(STYLE_CONFIG).map(key => ({
      id: key,
      name: key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, ' '),
      prompt: STYLE_CONFIG[key as keyof typeof STYLE_CONFIG].prompt,
      model: STYLE_CONFIG[key as keyof typeof STYLE_CONFIG].model
    }));

    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      success: true,
      styles: styles,
      strengthPresets: {
        subtle: 0.3,
        balanced: 0.7,
        creative: 0.9
      }
    });
  });
}
