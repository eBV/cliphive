import type { ViralityThreshold } from "../types/virality";

export const VIRALITY_THRESHOLDS: ViralityThreshold = {
  /** Clips scoring at or above this are auto-queued for rendering. */
  autoApprove: 0.72,
  /** Clips scoring in [suggest, autoApprove) are shown to user for review. */
  suggest: 0.55,
  /** Clips below this are discarded. */
  discard: 0.55,
};

/** Weights for the composite virality score formula. Must sum to 1.0. */
export const VIRALITY_SCORE_WEIGHTS = {
  hookScore: 0.25,
  retentionPrediction: 0.20,
  audioEnergyScore: 0.15,
  emotionIntensity: 0.10,
  quotabilityScore: 0.10,
  visualDynamism: 0.08,
  loopScore: 0.07,
  trendAlignment: 0.05,
} as const;

/** Clip duration targets by content type (seconds). */
export const CLIP_DURATION_TARGETS = {
  talking_head: { min: 7, max: 15, ideal: 11 },
  gameplay: { min: 15, max: 28, ideal: 20 },
  podcast: { min: 15, max: 28, ideal: 22 },
  tutorial: { min: 15, max: 28, ideal: 25 },
  reaction: { min: 10, max: 28, ideal: 18 },
  meme: { min: 5, max: 15, ideal: 8 },
  cinematic: { min: 15, max: 30, ideal: 22 },
  text_story: { min: 10, max: 28, ideal: 18 },
} as const;

/** Maximum clips detected per source media by default. */
export const DEFAULT_MAX_CLIPS_PER_SOURCE = 20;

/** Sliding window parameters for clip candidate extraction. */
export const SLIDING_WINDOW = {
  minSeconds: 5,
  maxSeconds: 30,
  strideSeconds: 0.5,
  iouThreshold: 0.5,
} as const;

/** Silence threshold — gaps longer than this (seconds) are penalized. */
export const MAX_SILENCE_GAP_SECONDS = 1.5;

/** Hook optimization: how far (seconds) to seek for a better start frame. */
export const HOOK_SEEK_RADIUS_SECONDS = 2.0;
