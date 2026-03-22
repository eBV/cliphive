/** Social media platform identifiers. */
export type Platform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "twitter"
  | "facebook"
  | "snapchat"
  | "linkedin"
  | "pinterest";

export interface PlatformSpec {
  id: Platform;
  name: string;
  resolution: string;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: string;
  maxDurationSeconds: number;
  captionLimit: number;
  hashtagLimit: number | null;
  supportsScheduling: boolean;
  supportsAnalytics: boolean;
}

export interface SocialAccount {
  id: string;
  userId: string;
  platform: Platform;
  platformUserId: string;
  username: string;
  followerCount: number;
  connectedAt: string;
  tokenExpiresAt: string | null;
}

export interface Publication {
  id: string;
  renderedClipId: string;
  socialAccountId: string;
  platformPostId: string | null;
  caption: string;
  hashtags: string[];
  scheduledAt: string | null;
  publishedAt: string | null;
  status: PublicationStatus;
  createdAt: string;
}

export type PublicationStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";

export interface PublishRequest {
  clipId: string;
  platforms: Platform[];
  caption: string;
  hashtags: string[];
  scheduledAt?: string;
  templateId?: string;
}
