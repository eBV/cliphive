/**
 * Instagram Graph API integration — Reels publishing.
 */
import axios from "axios";

const GRAPH_API = "https://graph.facebook.com/v20.0";

export interface InstagramUploadResult {
  platformPostId: string;
  shareUrl?: string;
}

export interface InstagramAnalytics {
  plays: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  reach: number;
}

/**
 * Get Facebook OAuth authorization URL (required for Instagram Graph API).
 */
export function getInstagramAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env["FACEBOOK_APP_ID"]!,
    redirect_uri: redirectUri,
    scope: "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_read_engagement",
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/v20.0/dialog/oauth?${params}`;
}

export async function exchangeInstagramCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; userId: string }> {
  const { data } = await axios.get(`${GRAPH_API}/oauth/access_token`, {
    params: {
      client_id: process.env["FACEBOOK_APP_ID"],
      client_secret: process.env["FACEBOOK_APP_SECRET"],
      redirect_uri: redirectUri,
      code,
    },
  });

  // Get Instagram business account ID
  const { data: me } = await axios.get(`${GRAPH_API}/me/accounts`, {
    params: { access_token: data.access_token, fields: "instagram_business_account" },
  });

  const igAccount = me.data?.[0]?.instagram_business_account;
  const igUserId = igAccount?.id ?? data.user_id;

  return { accessToken: data.access_token, userId: igUserId };
}

/**
 * Publish a Reel to Instagram.
 * Uses container-based async upload.
 */
export async function publishToInstagram(params: {
  accessToken: string;
  userId: string;
  videoUrl: string;
  caption: string;
  hashtags: string[];
  thumbnailUrl?: string;
}): Promise<InstagramUploadResult> {
  const caption = buildCaption(params.caption, params.hashtags);

  // Step 1: Create media container
  const { data: containerData } = await axios.post(
    `${GRAPH_API}/${params.userId}/media`,
    null,
    {
      params: {
        access_token: params.accessToken,
        media_type: "REELS",
        video_url: params.videoUrl,
        caption,
        ...(params.thumbnailUrl && { thumbnail_url: params.thumbnailUrl }),
      },
    }
  );

  const containerId = containerData.id;

  // Step 2: Wait for container to be FINISHED
  for (let i = 0; i < 24; i++) {
    await sleep(5_000);
    const { data: status } = await axios.get(`${GRAPH_API}/${containerId}`, {
      params: {
        access_token: params.accessToken,
        fields: "status_code",
      },
    });

    if (status.status_code === "FINISHED") break;
    if (status.status_code === "ERROR") {
      throw new Error("Instagram media container processing failed");
    }
  }

  // Step 3: Publish the container
  const { data: publishData } = await axios.post(
    `${GRAPH_API}/${params.userId}/media_publish`,
    null,
    {
      params: {
        access_token: params.accessToken,
        creation_id: containerId,
      },
    }
  );

  return { platformPostId: publishData.id };
}

export async function getInstagramAnalytics(
  accessToken: string,
  mediaId: string
): Promise<InstagramAnalytics> {
  const { data } = await axios.get(`${GRAPH_API}/${mediaId}/insights`, {
    params: {
      access_token: accessToken,
      metric: "plays,likes,comments,shares,saved,reach",
    },
  });

  const metrics: Record<string, number> = {};
  for (const item of data.data ?? []) {
    metrics[item.name] = item.values?.[0]?.value ?? 0;
  }

  return {
    plays: metrics["plays"] ?? 0,
    likes: metrics["likes"] ?? 0,
    comments: metrics["comments"] ?? 0,
    shares: metrics["shares"] ?? 0,
    saves: metrics["saved"] ?? 0,
    reach: metrics["reach"] ?? 0,
  };
}

function buildCaption(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return `${caption}\n\n${tags}`.trim().slice(0, 2200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Class-based wrapper ───────────────────────────────────────────────

import { withRetry, CircuitBreaker } from "../../utils/retry.js";

const _igBreaker = new CircuitBreaker(5, 120000);

export class InstagramIntegration {
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresAt: Date;
  }> {
    const { data } = await withRetry<{ data: { access_token: string; expires_in: number } }>(
      () =>
        _igBreaker.execute(() =>
          axios.get(`${GRAPH_API}/oauth/access_token`, {
            params: {
              grant_type: "ig_refresh_token",
              access_token: refreshToken,
            },
            timeout: 30000,
          })
        ),
      { attempts: 3, delayMs: 2000, backoff: "exponential" }
    );
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  async publishReel(
    accessToken: string,
    videoBuffer: Buffer,
    caption: string,
    platformUserId: string
  ): Promise<{ platformPostId: string; publishedAt: Date }> {
    const { StorageService } = await import("../storage.js");
    const storage = new StorageService();
    const tmpKey = `tmp/instagram/${Date.now()}.mp4`;
    await storage.uploadBuffer(tmpKey, videoBuffer, "video/mp4");
    const videoUrl = await storage.getPresignedDownloadUrl(tmpKey, 3600);

    const result = await publishToInstagram({
      accessToken,
      userId: platformUserId,
      videoUrl,
      caption,
      hashtags: [],
    });
    return { platformPostId: result.platformPostId, publishedAt: new Date() };
  }

  async getInsights(
    accessToken: string,
    mediaId: string
  ): Promise<{
    views: number; likes: number; comments: number; shares: number; saves: number;
    watchTimeSeconds: number; avgWatchPercentage: number; reach: number; engagementRate: number;
  }> {
    const metrics = await getInstagramAnalytics(accessToken, mediaId);
    const total = metrics.likes + metrics.comments + metrics.shares + metrics.saves;
    const engagementRate = metrics.plays > 0 ? total / metrics.plays : 0;
    return {
      views: metrics.plays,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      saves: metrics.saves,
      watchTimeSeconds: 0,
      avgWatchPercentage: 0,
      reach: metrics.reach,
      engagementRate,
    };
  }
}
