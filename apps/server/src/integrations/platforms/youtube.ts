/**
 * YouTube Data API v3 integration — Shorts upload.
 */
import axios from "axios";
import { createReadStream, statSync } from "fs";
import type { Readable } from "stream";

const YT_API = "https://www.googleapis.com/youtube/v3";
const YT_UPLOAD = "https://www.googleapis.com/upload/youtube/v3";

export interface YouTubeTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface YouTubeUploadResult {
  platformPostId: string;
  shareUrl: string;
}

export interface YouTubeAnalytics {
  views: number;
  likes: number;
  comments: number;
  subscribersGained: number;
  avgViewDuration: number;
}

export function getYouTubeAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env["GOOGLE_YOUTUBE_CLIENT_ID"]!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    access_type: "offline",
    state,
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeYouTubeCode(
  code: string,
  redirectUri: string
): Promise<YouTubeTokens> {
  const { data } = await axios.post("https://oauth2.googleapis.com/token", {
    code,
    client_id: process.env["GOOGLE_YOUTUBE_CLIENT_ID"],
    client_secret: process.env["GOOGLE_YOUTUBE_CLIENT_SECRET"],
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export async function refreshYouTubeToken(refreshToken: string): Promise<YouTubeTokens> {
  const { data } = await axios.post("https://oauth2.googleapis.com/token", {
    refresh_token: refreshToken,
    client_id: process.env["GOOGLE_YOUTUBE_CLIENT_ID"],
    client_secret: process.env["GOOGLE_YOUTUBE_CLIENT_SECRET"],
    grant_type: "refresh_token",
  });

  return {
    accessToken: data.access_token,
    refreshToken: refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Upload a Short to YouTube using resumable upload.
 */
export async function publishToYouTube(params: {
  accessToken: string;
  videoPath: string;
  title: string;
  description: string;
  hashtags: string[];
}): Promise<YouTubeUploadResult> {
  const fileSize = statSync(params.videoPath).size;
  const tags = params.hashtags.map((h) => h.replace(/^#/, ""));

  // Step 1: Initialize resumable upload session
  const { headers } = await axios.post(
    `${YT_UPLOAD}/videos?uploadType=resumable&part=snippet,status`,
    {
      snippet: {
        title: `${params.title} #Shorts`.slice(0, 100),
        description: `${params.description}\n\n${params.hashtags.join(" ")}`.slice(0, 5000),
        tags: [...tags, "Shorts", "short"],
        categoryId: "22",
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": fileSize,
      },
    }
  );

  const uploadUrl = headers["location"];
  if (!uploadUrl) throw new Error("YouTube did not return upload URL");

  // Step 2: Upload the file
  const videoStream = createReadStream(params.videoPath) as unknown as Blob;
  const { data } = await axios.put(uploadUrl, videoStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": fileSize,
    },
    maxBodyLength: Infinity,
  });

  const videoId = data.id;
  return {
    platformPostId: videoId,
    shareUrl: `https://youtube.com/shorts/${videoId}`,
  };
}

export async function getYouTubeAnalytics(
  accessToken: string,
  videoId: string
): Promise<YouTubeAnalytics> {
  const { data } = await axios.get(`${YT_API}/videos`, {
    params: {
      id: videoId,
      part: "statistics",
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const stats = data.items?.[0]?.statistics;
  if (!stats) return { views: 0, likes: 0, comments: 0, subscribersGained: 0, avgViewDuration: 0 };

  return {
    views: parseInt(stats.viewCount ?? "0"),
    likes: parseInt(stats.likeCount ?? "0"),
    comments: parseInt(stats.commentCount ?? "0"),
    subscribersGained: 0,
    avgViewDuration: 0,
  };
}

// ── Class-based wrapper ───────────────────────────────────────────────

import { withRetry, CircuitBreaker } from "../../utils/retry.js";
import { config } from "../../config.js";

const _ytBreaker = new CircuitBreaker(5, 120000);

export class YouTubeIntegration {
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }> {
    const result = await withRetry(
      () =>
        _ytBreaker.execute(() =>
          refreshYouTubeToken(refreshToken)
        ),
      { attempts: 3, delayMs: 2000, backoff: "exponential" }
    );
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
    };
  }

  async uploadVideo(
    accessToken: string,
    videoBuffer: Buffer,
    caption: string
  ): Promise<{ platformPostId: string; publishedAt: Date }> {
    // Write buffer to tmp file for resumable upload
    const { writeFileSync, unlinkSync } = await import("fs");
    const tmpPath = `/tmp/yt_${Date.now()}.mp4`;
    writeFileSync(tmpPath, videoBuffer);

    try {
      const result = await withRetry(
        () =>
          _ytBreaker.execute(() =>
            publishToYouTube({
              accessToken,
              videoPath: tmpPath,
              title: caption.slice(0, 100),
              description: caption.slice(0, 5000),
              hashtags: [],
            })
          ),
        { attempts: 3, delayMs: 5000, backoff: "exponential" }
      );
      return { platformPostId: result.platformPostId, publishedAt: new Date() };
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  async getVideoStats(
    accessToken: string,
    videoId: string
  ): Promise<{
    views: number; likes: number; comments: number; shares: number; saves: number;
    watchTimeSeconds: number; avgWatchPercentage: number; reach: number; engagementRate: number;
  }> {
    const stats = await getYouTubeAnalytics(accessToken, videoId);
    const total = stats.likes + stats.comments;
    const engagementRate = stats.views > 0 ? total / stats.views : 0;
    return {
      views: stats.views,
      likes: stats.likes,
      comments: stats.comments,
      shares: 0,
      saves: 0,
      watchTimeSeconds: stats.avgViewDuration,
      avgWatchPercentage: 0,
      reach: stats.views,
      engagementRate,
    };
  }
}
