export type DetectedHand = {
  handedness: 'Left' | 'Right';
  confidence: number;
  landmarks: Array<{ x: number; y: number; z: number }>;
};

export function detectHandsInImage(buffer: Buffer): Promise<DetectedHand[]>;
