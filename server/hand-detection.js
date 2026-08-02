/**
 * Hand Detection Module
 * Provides hand detection and landmark analysis for image validation
 * Integrates with MediaPipe or similar hand detection services
 */

/**
 * @typedef {Object} Landmark
 * @property {number} x - X coordinate (0-1)
 * @property {number} y - Y coordinate (0-1)
 * @property {number} z - Z coordinate (depth, 0-1)
 */

/**
 * @typedef {Object} DetectedHand
 * @property {'Left' | 'Right'} handedness - Which hand
 * @property {number} confidence - Detection confidence (0-1)
 * @property {Landmark[]} landmarks - 21 hand landmarks
 */

/**
 * Detect hands in an image buffer
 * @param {Buffer} imageBuffer - Image data as Buffer
 * @returns {Promise<DetectedHand[]>} Array of detected hands
 */
async function detectHandsInImage(imageBuffer) {
  try {
    // Try to use MediaPipe Hands if available
    if (global.HandDetectionModel) {
      return await global.HandDetectionModel(imageBuffer);
    }

    // Fallback: Return empty array if no model available
    console.warn('[HAND-DETECTION] No hand detection model available, returning empty hands array');
    return [];
  } catch (error) {
    console.error('[HAND-DETECTION] Error detecting hands:', error);
    return [];
  }
}
export { detectHandsInImage };

// Default export for convenience (optional)
export default { detectHandsInImage };
