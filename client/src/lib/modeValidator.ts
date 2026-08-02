/**
 * MODE VALIDATOR - Sanitization and validation to prevent code injection
 * All mode-related state changes must pass through this validator
 */

import type { AIMode } from '@shared/schema';
import { AI_MODES } from '@shared/schema';

// Valid mode list — derived from AI_MODES so new modes are auto-included
const VALID_MODES: readonly AIMode[] = Object.values(AI_MODES) as AIMode[];

/**
 * Validates that a mode is legitimate and safe to use
 * Prevents code injection by checking against whitelist
 */
export function validateMode(mode: unknown): mode is AIMode {
  if (typeof mode !== 'string') return false;
  return VALID_MODES.includes(mode as AIMode);
}

/**
 * Sanitizes and validates a mode string
 * Returns the mode if valid, throws error if invalid
 */
export function sanitizeMode(mode: unknown): AIMode {
  // Strict type check
  if (typeof mode !== 'string') {
    throw new Error('[SECURITY] Invalid mode type: must be string');
  }

  // Whitelist validation
  if (!VALID_MODES.includes(mode as AIMode)) {
    throw new Error(`[SECURITY] Invalid mode: "${mode}" not in allowed list`);
  }

  // Trim and lowercase (defensive)
  const cleaned = mode.toLowerCase().trim();
  
  // Final validation after cleaning
  if (!VALID_MODES.includes(cleaned as AIMode)) {
    throw new Error(`[SECURITY] Cleaned mode invalid: "${cleaned}"`);
  }

  return cleaned as AIMode;
}

/**
 * Validates an array of modes
 */
export function validateModes(modes: unknown): modes is AIMode[] {
  if (!Array.isArray(modes)) return false;
  return modes.every(m => validateMode(m));
}

/**
 * Sanitizes an array of modes
 */
export function sanitizeModes(modes: unknown): AIMode[] {
  if (!Array.isArray(modes)) {
    throw new Error('[SECURITY] Modes must be an array');
  }

  return modes.map((mode, index) => {
    try {
      return sanitizeMode(mode);
    } catch (error) {
      throw new Error(`[SECURITY] Invalid mode at index ${index}: ${error}`);
    }
  });
}

/**
 * Safe mode comparison - prevents logic confusion from type coercion
 */
export function modeEquals(a: AIMode, b: unknown): boolean {
  if (!validateMode(b)) return false;
  return a === b;
}

/**
 * Ensure mode array has exactly one mode
 */
export function ensureSingleMode(modes: AIMode[], fallback: AIMode = 'standard'): AIMode[] {
  if (modes.length === 0) {
    console.warn('[MODE_VALIDATOR] Empty modes array, using fallback:', fallback);
    return [fallback];
  }
  return [modes[0]];
}
