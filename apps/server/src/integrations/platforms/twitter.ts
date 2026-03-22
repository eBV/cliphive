/**
 * X (Twitter) API v2 integration — video tweet posting.
 */
import axios from "axios";
import { createReadStream, statSync } from "fs";

const UPLOAD_API = "https://upload.twitter.com/1.1";
const V2_API = "https://api.twitter.com/2";

export interface TwitterTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface TwitterUploadResult {
  platformPostId: string;
  shareUrl: string;
}

export interface TwitterAnalytics {
  impressions: number;
  engagements: number;
  videoViews: number;
  likes: number;
  retweets: number;
}

export function getTwitterAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env["TWITTER_CLIENT_ID"]!,
    redirect_uri: redirectUri,
    scope: "tweet.write tweet.read users.read media.write offline.access",
    state,
    code_challenge: state, // PKCE — simplified for brevity
    code_challenge_method: "plain",
  });
  return `https://twitter.com/i/oauth2/authorize?${params}`;
}

export async function exchangeTwitterCode(
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<TwitterTokens> {
  const credentials = Buffer.from(
    `${process.env["TWITTER_CLIENT_ID"]}:${process.env["TWITTER_CLIENT_SECRET"]}`
  ).toString("base64");

  const { data } = await axios.post(
    "https://api.twitter.com/2/oauth2/token",
    new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
    { headers: { Authorization: `Basic ${credentials}` } }
  );

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Upload a video to Twitter using chunked media upload.
 */
export async function publishToTwitter(params: {
  accessToken: string;
  videoPath: string;
  text: string;
  hashtags: string[];
}): Promise<TwitterUploadResult> {
  const fileSize = statSync(params.videoPath).size;

  // INIT
  const { data: initData } = await axios.post(
    `${UPLOAD_API}/media/upload.json`,
    new URLSearchParams({
      command: "INIT",
      media_type: "video/mp4",
      total_bytes: String(fileSize),
      media_category: "tweet_video",
    }),
    { headers: { Authorization: `Bearer ${params.accessToken}` } }
  );

  const mediaId = initData.media_id_string;
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const { readFileSync } = await import("fs");
  const buffer = readFileSync(params.videoPath);

  // APPEND chunks
  let segmentIndex = 0;
  for (let offset = 0; offset < fileSize; offset += CHUNK_SIZE) {
    const chunk = buffer.slice(offset, Math.min(offset + CHUNK_SIZE, fileSize));
    const formData = new FormData();
    formData.append("command", "APPEND");
    formData.append("media_id", mediaId);
    formData.append("segment_index", String(segmentIndex++));
    formData.append("media", new Blob([chunk], { type: "video/mp4" }));

    await axios.post(`${UPLOAD_API}/media/upload.json`, formData, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
  }

  // FINALIZE
  await axios.post(
    `${UPLOAD_API}/media/upload.json`,
    new URLSearchParams({ command: "FINALIZE", media_id: mediaId }),
    { headers: { Authorization: `Bearer ${params.accessToken}` } }
  );

  // Wait for processing
  await sleep(10_000);

  // Post tweet
  const tweetText = buildTweetText(params.text, params.hashtags);
  const { data: tweetData } = await axios.post(
    `${V2_API}/tweets`,
    { text: tweetText, media: { media_ids: [mediaId] } },
    { headers: { Authorization: `Bearer ${params.accessToken}` } }
  );

  const tweetId = tweetData.data.id;
  return {
    platformPostId: tweetId,
    shareUrl: `https://twitter.com/i/web/status/${tweetId}`,
  };
}

export async function getTwitterAnalytics(
  accessToken: string,
  tweetId: string
): Promise<TwitterAnalytics> {
  const { data } = await axios.get(`${V2_API}/tweets/${tweetId}`, {
    params: {
      "tweet.fields": "public_metrics,non_public_metrics",
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const pub = data.data?.public_metrics ?? {};
  const non = data.data?.non_public_metrics ?? {};

  return {
    impressions: non.impression_count ?? 0,
    engagements: non.user_profile_clicks ?? 0,
    videoViews: non.video_view_count ?? 0,
    likes: pub.like_count ?? 0,
    retweets: pub.retweet_count ?? 0,
  };
}

function buildTweetText(text: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return `${text}\n${tags}`.trim().slice(0, 280);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Class-based wrapper ───────────────────────────────────────────────

import { withRetry, CircuitBreaker } from "../../utils/retry.js";
import { config } from "../../config.js";

const _twBreaker = new CircuitBreaker(5, 120000);

export class TwitterIntegration {
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }> {
    const credentials = Buffer.from(
      `${config.TWITTER_CLIENT_ID}:${config.TWITTER_CLIENT_SECRET}`
    ).toString("base64");

    const response = await withRetry<{
      data: { access_token: string; refresh_token: string; expires_in: number };
    }>(
      () =>
        _twBreaker.execute(() =>
          axios.post(
            "https://api.twitter.com/2/oauth2/token",
            new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: refreshToken,
            }),
            { headers: { Authorization: `Basic ${credentials}` }, timeout: 30000 }
          )
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

  async postVideo(
    accessToken: string,
    videoBuffer: Buffer,
    caption: string
  ): Promise<{ platformPostId: string; publishedAt: Date }> {
    const { writeFileSync, unlinkSync } = await import("fs");
    const tmpPath = `/tmp/tw_${Date.now()}.mp4`;
    writeFileSync(tmpPath, videoBuffer);

    try {
      const result = await withRetry(
        () =>
          _twBreaker.execute(() =>
            publishToTwitter({
              accessToken,
              videoPath: tmpPath,
              text: caption.slice(0, 280),
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

  async getTweetMetrics(
    accessToken: string,
    tweetId: string
  ): Promise<{
    views: number; likes: number; comments: number; shares: number; saves: number;
    watchTimeSeconds: number; avgWatchPercentage: number; reach: number; engagementRate: number;
  }> {
    const metrics = await getTwitterAnalytics(accessToken, tweetId);
    const total = metrics.likes + metrics.retweets + metrics.engagements;
    const engagementRate = metrics.impressions > 0 ? total / metrics.impressions : 0;
    return {
      views: metrics.videoViews,
      likes: metrics.likes,
      comments: 0,
      shares: metrics.retweets,
      saves: 0,
      watchTimeSeconds: 0,
      avgWatchPercentage: 0,
      reach: metrics.impressions,
      engagementRate,
    };
  }
}
