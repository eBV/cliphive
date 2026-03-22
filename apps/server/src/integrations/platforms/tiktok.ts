/**
 * TikTok Content Posting API v2 integration.
 */
import axios, { type AxiosInstance } from "axios";
import { decrypt, encrypt } from "../../utils/crypto";

const BASE_URL = "https://open.tiktokapis.com/v2";

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface TikTokUploadResult {
  platformPostId: string;
  shareUrl?: string;
}

export interface TikTokAnalytics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  avgWatchTime: number;
}

/**
 * Get OAuth authorization URL for TikTok.
 */
export function getTikTokAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_key: process.env["TIKTOK_CLIENT_KEY"]!,
    scope: "video.publish,user.info.basic,video.list",
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeTikTokCode(
  code: string,
  redirectUri: string
): Promise<TikTokTokens> {
  const { data } = await axios.post(`${BASE_URL}/oauth/token/`, {
    client_key: process.env["TIKTOK_CLIENT_KEY"],
    client_secret: process.env["TIKTOK_CLIENT_SECRET"],
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Refresh an expired TikTok access token.
 */
export async function refreshTikTokToken(
  encryptedRefreshToken: string
): Promise<TikTokTokens> {
  const refreshToken = decrypt(encryptedRefreshToken);

  const { data } = await axios.post(`${BASE_URL}/oauth/token/`, {
    client_key: process.env["TIKTOK_CLIENT_KEY"],
    client_secret: process.env["TIKTOK_CLIENT_SECRET"],
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Upload and publish a video to TikTok.
 */
export async function publishToTikTok(params: {
  accessToken: string;
  videoUrl: string;
  caption: string;
  hashtags: string[];
}): Promise<TikTokUploadResult> {
  const client = createClient(params.accessToken);

  // Step 1: Initialize upload
  const { data: initData } = await client.post("/post/video/init/", {
    post_info: {
      title: buildCaption(params.caption, params.hashtags),
      privacy_level: "PUBLIC_TO_EVERYONE",
      disable_comment: false,
      disable_duet: false,
      disable_stitch: false,
    },
    source_info: {
      source: "PULL_FROM_URL",
      video_url: params.videoUrl,
    },
  });

  const publishId = initData.data.publish_id;

  // Poll for completion (up to 5 minutes)
  for (let i = 0; i < 30; i++) {
    await sleep(10_000);
    const { data: statusData } = await client.post("/post/video/status/fetch/", {
      publish_id: publishId,
    });

    if (statusData.data.status === "PUBLISH_COMPLETE") {
      return { platformPostId: publishId };
    }
    if (statusData.data.status === "FAILED") {
      throw new Error(`TikTok publish failed: ${statusData.data.fail_reason}`);
    }
  }

  throw new Error("TikTok publish timed out");
}

/**
 * Fetch analytics for a TikTok post.
 */
export async function getTikTokAnalytics(
  accessToken: string,
  videoId: string
): Promise<TikTokAnalytics> {
  const client = createClient(accessToken);

  const { data } = await client.post("/video/query/", {
    filters: { video_ids: [videoId] },
    fields: [
      "play_count",
      "like_count",
      "comment_count",
      "share_count",
      "average_time_watched",
    ],
  });

  const video = data.data?.videos?.[0];
  if (!video) return { views: 0, likes: 0, comments: 0, shares: 0, avgWatchTime: 0 };

  return {
    views: video.play_count ?? 0,
    likes: video.like_count ?? 0,
    comments: video.comment_count ?? 0,
    shares: video.share_count ?? 0,
    avgWatchTime: video.average_time_watched ?? 0,
  };
}

function createClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 30_000,
  });
}

function buildCaption(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return `${caption}\n\n${tags}`.trim().slice(0, 2200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Class-based wrapper for DI-friendly service consumption ──────────

import { withRetry, CircuitBreaker } from "../../utils/retry.js";
import { config } from "../../config.js";

const _breaker = new CircuitBreaker(5, 120000);

export class TikTokIntegration {
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }> {
    const response = await withRetry<{
      data: { access_token: string; refresh_token: string; expires_in: number };
    }>(
      () =>
        _breaker.execute(() =>
          axios.post(`${BASE_URL}/oauth/token/`, {
            client_key: config.TIKTOK_CLIENT_KEY,
            client_secret: config.TIKTOK_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
          }, { timeout: 30000 })
        ),
      { attempts: 3, delayMs: 2000, backoff: "exponential" }
    );
    const d = response.data;
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token,
      expiresAt: new Date(Date.now() + d.expires_in * 1000),
    };
  }

  async uploadVideo(
    accessToken: string,
    videoBuffer: Buffer,
    caption: string
  ): Promise<{ platformPostId: string; publishedAt: Date }> {
    // Generate a temporary CDN URL for pull-based upload
    const { StorageService } = await import("../storage.js");
    const storage = new StorageService();
    const tmpKey = `tmp/tiktok/${Date.now()}.mp4`;
    await storage.uploadBuffer(tmpKey, videoBuffer, "video/mp4");
    const videoUrl = await storage.getPresignedDownloadUrl(tmpKey, 3600);

    const result = await publishToTikTok({
      accessToken,
      videoUrl,
      caption,
      hashtags: [],
    });

    return { platformPostId: result.platformPostId, publishedAt: new Date() };
  }

  async getVideoAnalytics(
    accessToken: string,
    videoId: string
  ): Promise<{
    views: number; likes: number; comments: number; shares: number; saves: number;
    watchTimeSeconds: number; avgWatchPercentage: number; reach: number; engagementRate: number;
  }> {
    const metrics = await getTikTokAnalytics(accessToken, videoId);
    const total = metrics.likes + metrics.comments + metrics.shares;
    const engagementRate = metrics.views > 0 ? total / metrics.views : 0;
    return {
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      saves: 0,
      watchTimeSeconds: metrics.avgWatchTime / 1000,
      avgWatchPercentage: 0,
      reach: metrics.views,
      engagementRate,
    };
  }
}
