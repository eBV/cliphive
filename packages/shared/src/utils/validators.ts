import type { Platform } from "../types/platform";
import { PLATFORM_SPECS } from "../constants/platforms";

/**
 * Validate that a clip duration does not exceed the platform's maximum.
 */
export function validateClipDuration(
  durationSeconds: number,
  platform: Platform
): { valid: boolean; message?: string } {
  const spec = PLATFORM_SPECS[platform];
  if (durationSeconds > spec.maxDurationSeconds) {
    return {
      valid: false,
      message: `Clip is ${durationSeconds.toFixed(1)}s but ${spec.name} allows max ${spec.maxDurationSeconds}s`,
    };
  }
  return { valid: true };
}

/**
 * Validate that a caption does not exceed the platform's character limit.
 */
export function validateCaption(
  caption: string,
  platform: Platform
): { valid: boolean; remaining: number; message?: string } {
  const spec = PLATFORM_SPECS[platform];
  const remaining = spec.captionLimit - caption.length;
  if (remaining < 0) {
    return {
      valid: false,
      remaining,
      message: `Caption exceeds ${spec.name} limit by ${Math.abs(remaining)} characters`,
    };
  }
  return { valid: true, remaining };
}

/**
 * Validate a virality score is within [0, 1].
 */
export function validateViralityScore(score: number): boolean {
  return score >= 0 && score <= 1 && Number.isFinite(score);
}

/**
 * Basic UUID v4 format check.
 */
export function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Check if a YouTube URL is valid.
 */
export function isValidYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/.test(url);
}
