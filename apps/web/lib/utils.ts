import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format a file size in bytes to a human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Format a virality score (0–1) as a percentage string with color class.
 */
export function viralityDisplay(score: number): {
  label: string;
  colorClass: string;
  tier: "high" | "medium" | "low";
} {
  const pct = Math.round(score * 100);
  if (score >= 0.72) {
    return { label: `${pct}%`, colorClass: "text-green-400", tier: "high" };
  }
  if (score >= 0.55) {
    return { label: `${pct}%`, colorClass: "text-yellow-400", tier: "medium" };
  }
  return { label: `${pct}%`, colorClass: "text-red-400", tier: "low" };
}

/**
 * Truncate a string to maxLen characters with an ellipsis.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 3)}...`;
}

/**
 * Generate a random hex API key.
 */
export function generateApiKey(length = 32): string {
  const chars = "abcdef0123456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
