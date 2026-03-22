/**
 * Facebook Graph API integration — Reels publishing.
 */
import axios from "axios";

const GRAPH_API = "https://graph.facebook.com/v20.0";

export interface FacebookUploadResult {
  platformPostId: string;
}

export interface FacebookAnalytics {
  views: number;
  reactions: number;
  comments: number;
  shares: number;
}

export async function publishToFacebook(params: {
  accessToken: string;
  pageId: string;
  videoUrl: string;
  caption: string;
  hashtags: string[];
}): Promise<FacebookUploadResult> {
  const description = buildCaption(params.caption, params.hashtags);

  const { data } = await axios.post(
    `${GRAPH_API}/${params.pageId}/video_reels`,
    {
      access_token: params.accessToken,
      upload_phase: "finish",
      video_state: "PUBLISHED",
      description,
      file_url: params.videoUrl,
    }
  );

  return { platformPostId: data.video_id ?? data.id };
}

export async function getFacebookAnalytics(
  accessToken: string,
  videoId: string
): Promise<FacebookAnalytics> {
  const { data } = await axios.get(`${GRAPH_API}/${videoId}`, {
    params: {
      access_token: accessToken,
      fields: "video_insights{name,period,values}",
    },
  });

  const insights: Record<string, number> = {};
  for (const insight of data.video_insights?.data ?? []) {
    insights[insight.name] = insight.values?.[0]?.value ?? 0;
  }

  return {
    views: insights["total_video_views"] ?? 0,
    reactions: insights["post_reactions_by_type_total"] ?? 0,
    comments: insights["post_comments"] ?? 0,
    shares: insights["post_activity_by_action_type"] ?? 0,
  };
}

function buildCaption(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return `${caption}\n\n${tags}`.trim().slice(0, 63206);
}

// ── Class-based wrapper ───────────────────────────────────────────────

import { withRetry, CircuitBreaker } from "../../utils/retry.js";

const _fbBreaker = new CircuitBreaker(5, 120000);

export class FacebookIntegration {
  async uploadReel(
    accessToken: string,
    videoBuffer: Buffer,
    caption: string,
    platformUserId: string
  ): Promise<{ platformPostId: string; publishedAt: Date }> {
    const { StorageService } = await import("../storage.js");
    const storage = new StorageService();
    const tmpKey = `tmp/facebook/${Date.now()}.mp4`;
    await storage.uploadBuffer(tmpKey, videoBuffer, "video/mp4");
    const videoUrl = await storage.getPresignedDownloadUrl(tmpKey, 3600);

    const result = await withRetry(
      () =>
        _fbBreaker.execute(() =>
          publishToFacebook({
            accessToken,
            pageId: platformUserId,
            videoUrl,
            caption,
            hashtags: [],
          })
        ),
      { attempts: 3, delayMs: 5000, backoff: "exponential" }
    );
    return { platformPostId: result.platformPostId, publishedAt: new Date() };
  }

  async getInsights(
    accessToken: string,
    videoId: string,
    _platformUserId: string
  ): Promise<{
    views: number; likes: number; comments: number; shares: number; saves: number;
    watchTimeSeconds: number; avgWatchPercentage: number; reach: number; engagementRate: number;
  }> {
    const metrics = await getFacebookAnalytics(accessToken, videoId);
    const total = metrics.reactions + metrics.comments + metrics.shares;
    const engagementRate = metrics.views > 0 ? total / metrics.views : 0;
    return {
      views: metrics.views,
      likes: metrics.reactions,
      comments: metrics.comments,
      shares: metrics.shares,
      saves: 0,
      watchTimeSeconds: 0,
      avgWatchPercentage: 0,
      reach: metrics.views,
      engagementRate,
    };
  }
}
