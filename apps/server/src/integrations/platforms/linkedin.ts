/**
 * LinkedIn Marketing API integration — UGC video posts.
 */
import axios from "axios";
import { createReadStream, statSync } from "fs";

const LINKEDIN_API = "https://api.linkedin.com/v2";
const UPLOAD_API = "https://api.linkedin.com/mediaUpload";

export interface LinkedInUploadResult {
  platformPostId: string;
}

export interface LinkedInAnalytics {
  impressions: number;
  clicks: number;
  reactions: number;
  comments: number;
}

export function getLinkedInAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env["LINKEDIN_CLIENT_ID"]!,
    redirect_uri: redirectUri,
    state,
    scope: "r_liteprofile w_member_social r_organization_social",
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

export async function exchangeLinkedInCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const { data } = await axios.post(
    "https://www.linkedin.com/oauth/v2/accessToken",
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: process.env["LINKEDIN_CLIENT_ID"]!,
      client_secret: process.env["LINKEDIN_CLIENT_SECRET"]!,
    })
  );

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export async function publishToLinkedIn(params: {
  accessToken: string;
  personId: string;
  videoPath: string;
  text: string;
  hashtags: string[];
}): Promise<LinkedInUploadResult> {
  const fileSize = statSync(params.videoPath).size;
  const headers = {
    Authorization: `Bearer ${params.accessToken}`,
    "Content-Type": "application/json",
    "X-Restli-Protocol-Version": "2.0.0",
  };

  // Step 1: Register upload
  const { data: registerData } = await axios.post(
    `${LINKEDIN_API}/assets?action=registerUpload`,
    {
      registerUploadRequest: {
        owner: `urn:li:person:${params.personId}`,
        recipes: ["urn:li:digitalmediaRecipe:feedshare-video"],
        serviceRelationships: [
          {
            identifier: "urn:li:userGeneratedContent",
            relationshipType: "OWNER",
          },
        ],
      },
    },
    { headers }
  );

  const assetUrn = registerData.value.asset;
  const uploadUrl = registerData.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl;

  // Step 2: Upload the video
  await axios.put(uploadUrl, createReadStream(params.videoPath), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": fileSize,
    },
    maxBodyLength: Infinity,
  });

  // Step 3: Create post
  const caption = buildLinkedInCaption(params.text, params.hashtags);
  const { data: postData } = await axios.post(
    `${LINKEDIN_API}/ugcPosts`,
    {
      author: `urn:li:person:${params.personId}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: caption },
          shareMediaCategory: "VIDEO",
          media: [
            {
              status: "READY",
              media: assetUrn,
              title: { text: params.text.slice(0, 100) },
            },
          ],
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    },
    { headers }
  );

  return { platformPostId: postData.id };
}

export async function getLinkedInAnalytics(
  accessToken: string,
  ugcPostId: string
): Promise<LinkedInAnalytics> {
  const { data } = await axios.get(
    `${LINKEDIN_API}/socialActions/${encodeURIComponent(ugcPostId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  return {
    impressions: 0,
    clicks: 0,
    reactions: data.likesSummary?.totalLikes ?? 0,
    comments: data.commentsSummary?.totalFirstLevelComments ?? 0,
  };
}

function buildLinkedInCaption(text: string, hashtags: string[]): string {
  const tags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return `${text}\n\n${tags}`.trim().slice(0, 3000);
}

// ── Class-based wrapper ───────────────────────────────────────────────

import { withRetry, CircuitBreaker } from "../../utils/retry.js";

const _liBreaker = new CircuitBreaker(5, 120000);

export class LinkedInIntegration {
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresAt: Date;
  }> {
    // LinkedIn doesn't support standard refresh — tokens are long-lived
    // Return the same token and set expiry 60 days out
    return {
      accessToken: refreshToken,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    };
  }

  async createVideoPost(
    accessToken: string,
    videoBuffer: Buffer,
    caption: string,
    platformUserId: string
  ): Promise<{ platformPostId: string; publishedAt: Date }> {
    const { writeFileSync, unlinkSync } = await import("fs");
    const tmpPath = `/tmp/li_${Date.now()}.mp4`;
    writeFileSync(tmpPath, videoBuffer);

    try {
      const result = await withRetry(
        () =>
          _liBreaker.execute(() =>
            publishToLinkedIn({
              accessToken,
              personId: platformUserId,
              videoPath: tmpPath,
              text: caption,
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

  async getPostStats(
    accessToken: string,
    postId: string
  ): Promise<{
    views: number; likes: number; comments: number; shares: number; saves: number;
    watchTimeSeconds: number; avgWatchPercentage: number; reach: number; engagementRate: number;
  }> {
    const metrics = await getLinkedInAnalytics(accessToken, postId);
    const total = metrics.reactions + metrics.comments + metrics.clicks;
    const engagementRate = metrics.impressions > 0 ? total / metrics.impressions : 0;
    return {
      views: metrics.impressions,
      likes: metrics.reactions,
      comments: metrics.comments,
      shares: 0,
      saves: 0,
      watchTimeSeconds: 0,
      avgWatchPercentage: 0,
      reach: metrics.impressions,
      engagementRate,
    };
  }
}
