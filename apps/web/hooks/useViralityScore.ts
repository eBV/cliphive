"use client";

import { trpc } from "../lib/trpc";
import { viralityDisplay } from "../lib/utils";
import { VIRALITY_THRESHOLDS } from "@cliphive/shared";

/**
 * Returns formatted virality score data for a clip.
 */
export function useViralityScore(clipId: string) {
  const { data: clip } = trpc.clip.getById.useQuery({ id: clipId });
  const rescoreMutation = trpc.clip.rescore.useMutation();

  const score = clip?.viralityScore ?? null;
  const display = score !== null ? viralityDisplay(score) : null;

  const isAutoApproved = score !== null && score >= VIRALITY_THRESHOLDS.autoApprove;
  const isSuggested =
    score !== null &&
    score >= VIRALITY_THRESHOLDS.suggest &&
    score < VIRALITY_THRESHOLDS.autoApprove;

  return {
    score,
    display,
    isAutoApproved,
    isSuggested,
    rescore: () => rescoreMutation.mutate({ id: clipId }),
    isRescoring: rescoreMutation.isPending,
  };
}
