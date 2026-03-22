/**
 * Format seconds as "mm:ss" or "hh:mm:ss".
 */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Format seconds as a human-readable duration string.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/**
 * Clamp a time value within [min, max].
 */
export function clampTime(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Check if two time ranges [a1, a2] and [b1, b2] overlap by at least minOverlap seconds.
 */
export function timeRangesOverlap(
  a1: number,
  a2: number,
  b1: number,
  b2: number,
  minOverlap = 0
): boolean {
  const overlap = Math.min(a2, b2) - Math.max(a1, b1);
  return overlap > minOverlap;
}

/**
 * Compute Intersection over Union (IoU) for two time ranges.
 */
export function timeIoU(a1: number, a2: number, b1: number, b2: number): number {
  const intersection = Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  const union = Math.max(a2, b2) - Math.min(a1, b1);
  if (union === 0) return 0;
  return intersection / union;
}

/**
 * Convert frame number to seconds given a frame rate.
 */
export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

/**
 * Convert seconds to frame number given a frame rate.
 */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/**
 * Format bytes as a human-readable file size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
