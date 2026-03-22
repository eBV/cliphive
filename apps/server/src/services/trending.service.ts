import axios from "axios";
import { createDb, trendingSounds, trendingHashtags } from "@cliphive/db";
import type { Platform } from "@cliphive/shared";
import type { TrendingSound, TrendingHashtag } from "@cliphive/shared";
import { config } from "../config.js";
import { withRetry, CircuitBreaker } from "../utils/retry.js";

interface ClipRow {
  id: string;
  emotionTags: unknown;
  transcriptSnippet: string | null;
  viralityScore: number | null;
}

export class TrendingService {
  private readonly db: ReturnType<typeof createDb>;
  private readonly breaker: CircuitBreaker;

  constructor() {
    this.db = createDb(config.DATABASE_URL);
    this.breaker = new CircuitBreaker(5, 120000);
  }

  async fetchAndStoreTrending(platforms: Platform[] = ["tiktok", "instagram", "youtube"]): Promise<void> {
    for (const platform of platforms) {
      await this.fetchSoundsForPlatform(platform).catch((err) =>
        console.error(`[Trending] Failed to fetch sounds for ${platform}:`, err)
      );
      await this.fetchHashtagsForPlatform(platform).catch((err) =>
        console.error(`[Trending] Failed to fetch hashtags for ${platform}:`, err)
      );
    }
  }

  private async fetchSoundsForPlatform(platform: Platform): Promise<void> {
    const sounds = await this.fetchSoundsFromPlatformApi(platform);
    if (sounds.length === 0) return;

    await this.db.insert(trendingSounds).values(
      sounds.map((s) => ({
        platform,
        soundName: s.soundName,
        artist: s.artist,
        soundUrl: s.soundUrl,
        usageCount: s.usageCount,
        trendingRank: s.trendingRank,
        fetchedAt: new Date(),
      }))
    );

    console.info(`[Trending] Stored ${sounds.length} sounds for ${platform}`);
  }

  private async fetchHashtagsForPlatform(platform: Platform): Promise<void> {
    const hashtags = await this.fetchHashtagsFromPlatformApi(platform);
    if (hashtags.length === 0) return;

    await this.db.insert(trendingHashtags).values(
      hashtags.map((h) => ({
        platform,
        hashtag: h.hashtag,
        volume: h.volume,
        velocity: h.velocity,
        category: h.category,
        fetchedAt: new Date(),
      }))
    );

    console.info(`[Trending] Stored ${hashtags.length} hashtags for ${platform}`);
  }

  private async fetchSoundsFromPlatformApi(platform: Platform): Promise<Omit<TrendingSound, "id" | "fetchedAt">[]> {
    switch (platform) {
      case "tiktok":
        return this.fetchTikTokTrendingSounds();
      case "instagram":
        return this.fetchInstagramTrendingSounds();
      default:
        return [];
    }
  }

  private async fetchHashtagsFromPlatformApi(platform: Platform): Promise<Omit<TrendingHashtag, "id" | "fetchedAt">[]> {
    switch (platform) {
      case "tiktok":
        return this.fetchTikTokTrendingHashtags();
      case "instagram":
        return this.fetchInstagramTrendingHashtags();
      case "youtube":
        return this.fetchYouTubeTrendingTopics();
      case "twitter":
        return this.fetchTwitterTrends();
      default:
        return [];
    }
  }

  private async fetchTikTokTrendingSounds(): Promise<Omit<TrendingSound, "id" | "fetchedAt">[]> {
    if (!config.TIKTOK_CLIENT_KEY) return [];

    try {
      const response = await withRetry<{ data: { data?: { sound_list?: Array<{
        music_id?: string;
        music_name?: string;
        author_name?: string;
        play_url?: string;
        item_count?: number;
      }> } } }>(
        () =>
          this.breaker.execute(() =>
            axios.get<{ data?: { sound_list?: unknown[] } }>(
              "https://open.tiktokapis.com/v2/research/trending/music/",
              {
                params: { fields: "music_id,music_name,author_name,play_url,item_count" },
                headers: { Authorization: `Bearer ${config.TIKTOK_CLIENT_KEY}` },
                timeout: 30000,
              }
            )
          ),
        { attempts: 3, delayMs: 2000, backoff: "exponential" }
      );

      const list = response.data?.data?.sound_list ?? [];
      return list.slice(0, 50).map((s, i) => ({
        platform: "tiktok",
        soundName: s.music_name ?? "Unknown",
        artist: s.author_name ?? "Unknown",
        soundUrl: s.play_url ?? "",
        usageCount: s.item_count ?? 0,
        trendingRank: i + 1,
      }));
    } catch (err) {
      console.warn("[Trending] TikTok sounds API failed:", (err as Error).message);
      return [];
    }
  }

  private async fetchTikTokTrendingHashtags(): Promise<Omit<TrendingHashtag, "id" | "fetchedAt">[]> {
    if (!config.TIKTOK_CLIENT_KEY) return [];

    try {
      const response = await withRetry<{ data: { data?: { hashtag_list?: Array<{
        hashtag_name?: string;
        video_views?: number;
        category?: string;
      }> } } }>(
        () =>
          this.breaker.execute(() =>
            axios.get(
              "https://open.tiktokapis.com/v2/research/trending/hashtag/",
              {
                params: { fields: "hashtag_name,video_views,category" },
                headers: { Authorization: `Bearer ${config.TIKTOK_CLIENT_KEY}` },
                timeout: 30000,
              }
            )
          ),
        { attempts: 3, delayMs: 2000, backoff: "exponential" }
      );

      const list = response.data?.data?.hashtag_list ?? [];
      return list.slice(0, 100).map((h) => ({
        platform: "tiktok",
        hashtag: h.hashtag_name ?? "",
        volume: h.video_views ?? 0,
        velocity: 0,
        category: h.category ?? "general",
      }));
    } catch (err) {
      console.warn("[Trending] TikTok hashtag API failed:", (err as Error).message);
      return [];
    }
  }

  private async fetchInstagramTrendingSounds(): Promise<Omit<TrendingSound, "id" | "fetchedAt">[]> {
    // Instagram Graph API doesn't expose trending sounds directly
    return [];
  }

  private async fetchInstagramTrendingHashtags(): Promise<Omit<TrendingHashtag, "id" | "fetchedAt">[]> {
    // Instagram trending hashtags not directly available via API
    return [];
  }

  private async fetchYouTubeTrendingTopics(): Promise<Omit<TrendingHashtag, "id" | "fetchedAt">[]> {
    if (!config.YOUTUBE_CLIENT_ID) return [];
    return [];
  }

  private async fetchTwitterTrends(): Promise<Omit<TrendingHashtag, "id" | "fetchedAt">[]> {
    if (!config.TWITTER_CLIENT_ID) return [];

    try {
      const response = await withRetry<{ data: Array<{ name?: string; tweet_count?: number; category?: string }> }>(
        () =>
          this.breaker.execute(() =>
            axios.get(
              "https://api.twitter.com/2/trends/by/woeid/1",
              {
                headers: { Authorization: `Bearer ${config.TWITTER_CLIENT_SECRET}` },
                timeout: 30000,
              }
            )
          ),
        { attempts: 3, delayMs: 2000, backoff: "exponential" }
      );

      return (response.data ?? []).slice(0, 50).map((t) => ({
        platform: "twitter",
        hashtag: (t.name ?? "").replace(/^#/, ""),
        volume: t.tweet_count ?? 0,
        velocity: 0,
        category: "trending",
      }));
    } catch (err) {
      console.warn("[Trending] Twitter trends API failed:", (err as Error).message);
      return [];
    }
  }

  async getSuggestionsForClip(
    clip: ClipRow,
    platforms: Platform[]
  ): Promise<{ sounds: TrendingSound[]; hashtags: TrendingHashtag[] }> {
    const { gte } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const sounds = await this.db
      .select()
      .from(trendingSounds)
      .where(gte(trendingSounds.fetchedAt, cutoff))
      .orderBy(trendingSounds.trendingRank)
      .limit(10);

    const hashtags = await this.db
      .select()
      .from(trendingHashtags)
      .where(gte(trendingHashtags.fetchedAt, cutoff))
      .orderBy(trendingHashtags.volume)
      .limit(20);

    return { sounds, hashtags };
  }
}
