import { VIRALITY_SCORE_WEIGHTS } from "../constants/virality-thresholds";
import type { ViralityScore } from "../types/virality";

/**
 * Compute the composite virality score from component scores.
 * All inputs must be normalized to [0, 1].
 */
export function computeViralityScore(components: ViralityScore): number {
  const w = VIRALITY_SCORE_WEIGHTS;
  return (
    w.hookScore * components.hookScore +
    w.retentionPrediction * components.retentionPrediction +
    w.audioEnergyScore * components.audioEnergyScore +
    w.emotionIntensity * components.emotionIntensity +
    w.quotabilityScore * components.quotabilityScore +
    w.visualDynamism * components.visualDynamism +
    w.loopScore * components.loopScore +
    w.trendAlignment * components.trendAlignment
  );
}

/**
 * Normalize a raw score to [0, 1] using min-max normalization.
 */
export function normalizeScore(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Compute engagement rate from raw metrics.
 */
export function computeEngagementRate(params: {
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
}): number {
  if (params.views === 0) return 0;
  const interactions = params.likes + params.comments + params.shares + params.saves;
  return interactions / params.views;
}

/**
 * Score a clip's "loop potential" — how well the last frame connects to the first.
 * Returns 0–1.
 */
export function computeLoopScore(
  firstFrameEmbedding: number[],
  lastFrameEmbedding: number[]
): number {
  if (firstFrameEmbedding.length !== lastFrameEmbedding.length) return 0;
  const cosineSimilarity = dotProduct(firstFrameEmbedding, lastFrameEmbedding) /
    (magnitude(firstFrameEmbedding) * magnitude(lastFrameEmbedding));
  return Math.max(0, cosineSimilarity);
}

function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
}

function magnitude(v: number[]): number {
  return Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
}
