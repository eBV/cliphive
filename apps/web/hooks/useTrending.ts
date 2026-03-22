"use client";

import { trpc } from "../lib/trpc";
import type { Platform } from "@cliphive/shared";

/**
 * Returns trending sounds and hashtags for a platform.
 */
export function useTrending(platform: Platform) {
  const { data: sounds, isLoading: soundsLoading } = trpc.trending.getSounds.useQuery(
    { platform },
    { staleTime: 5 * 60 * 1000 } // 5 min cache
  );
  const { data: hashtags, isLoading: hashtagsLoading } = trpc.trending.getHashtags.useQuery(
    { platform },
    { staleTime: 5 * 60 * 1000 }
  );

  return {
    sounds: sounds ?? [],
    hashtags: hashtags ?? [],
    isLoading: soundsLoading || hashtagsLoading,
  };
}
