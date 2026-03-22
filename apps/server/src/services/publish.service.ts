import { eq } from "drizzle-orm";
import { createDb, publications, renderedClips, socialAccounts, clips } from "@cliphive/db";
import type { Platform } from "@cliphive/shared";
import { config } from "../config.js";
import { StorageService } from "../integrations/storage.js";
import { CryptoService } from "../utils/crypto.js";
import { withRetry, CircuitBreaker } from "../utils/retry.js";
import { getSocketIO } from "../index.js";
import { analyticsQueue } from "../jobs/queue.js";

interface PublishResult {
  platformPostId: string;
  publishedAt: Date;
}

export class PublishService {
  private readonly db: ReturnType<typeof createDb>;
  private readonly storage: StorageService;
  private readonly crypto: CryptoService;
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor() {
    this.db = createDb(config.DATABASE_URL);
    this.storage = new StorageService();
    this.crypto = new CryptoService();
  }

  private getBreaker(platform: string): CircuitBreaker {
    let breaker = this.breakers.get(platform);
    if (!breaker) {
      breaker = new CircuitBreaker(5, 120000);
      this.breakers.set(platform, breaker);
    }
    return breaker;
  }

  async publishPublication(publicationId: string, userId: string): Promise<void> {
    const [pub] = await this.db
      .select()
      .from(publications)
      .where(eq(publications.id, publicationId))
      .limit(1);

    if (!pub) throw new Error(`Publication not found: ${publicationId}`);

    const [renderedClip] = await this.db
      .select()
      .from(renderedClips)
      .where(eq(renderedClips.id, pub.renderedClipId))
      .limit(1);

    if (!renderedClip) throw new Error(`Rendered clip not found`);

    const [account] = await this.db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, pub.socialAccountId))
      .limit(1);

    if (!account) throw new Error(`Social account not found`);
    if (!account.accessToken) throw new Error(`No access token for account`);

    const accessToken = this.crypto.decrypt(account.accessToken);
    const platform = account.platform as Platform;

    // Download the rendered video
    const videoBuffer = await this.storage.downloadBuffer(renderedClip.s3Key);
    const caption = pub.caption ?? "";
    const hashtags = (pub.hashtags as string[] | null) ?? [];
    const fullCaption = hashtags.length > 0
      ? `${caption}\n\n${hashtags.map((h) => `#${h}`).join(" ")}`
      : caption;

    await this.db
      .update(publications)
      .set({ status: "publishing" })
      .where(eq(publications.id, publicationId));

    let result: PublishResult;

    try {
      result = await withRetry(
        () =>
          this.getBreaker(platform).execute(() =>
            this.publishToPlatform(
              platform,
              accessToken,
              videoBuffer,
              fullCaption,
              renderedClip.platform,
              account.platformUserId
            )
          ),
        { attempts: 3, delayMs: 5000, backoff: "exponential" }
      );
    } catch (err) {
      await this.db
        .update(publications)
        .set({ status: "failed" })
        .where(eq(publications.id, publicationId));

      try {
        const io = getSocketIO();
        io.to(`user:${userId}`).emit("publish:failed", {
          publicationId,
          platform,
          error: (err as Error).message,
        });
      } catch {
        // Socket unavailable
      }

      throw err;
    }

    await this.db
      .update(publications)
      .set({
        status: "published",
        platformPostId: result.platformPostId,
        publishedAt: result.publishedAt,
      })
      .where(eq(publications.id, publicationId));

    // Queue analytics fetch after 1 hour
    await analyticsQueue.add(
      "fetch-analytics",
      { publicationId, userId },
      {
        delay: 3600000,
        attempts: 3,
        backoff: { type: "exponential", delay: 10000 },
      }
    );

    try {
      const io = getSocketIO();
      io.to(`user:${userId}`).emit("publish:success", {
        publicationId,
        platform,
        platformPostId: result.platformPostId,
      });
    } catch {
      // Socket unavailable
    }
  }

  private async publishToPlatform(
    platform: Platform,
    accessToken: string,
    videoBuffer: Buffer,
    caption: string,
    _platformSpec: string,
    platformUserId: string
  ): Promise<PublishResult> {
    switch (platform) {
      case "tiktok": {
        const { TikTokIntegration } = await import("../integrations/platforms/tiktok.js");
        const tk = new TikTokIntegration();
        return tk.uploadVideo(accessToken, videoBuffer, caption);
      }
      case "instagram": {
        const { InstagramIntegration } = await import("../integrations/platforms/instagram.js");
        const ig = new InstagramIntegration();
        return ig.publishReel(accessToken, videoBuffer, caption, platformUserId);
      }
      case "youtube": {
        const { YouTubeIntegration } = await import("../integrations/platforms/youtube.js");
        const yt = new YouTubeIntegration();
        return yt.uploadVideo(accessToken, videoBuffer, caption);
      }
      case "twitter": {
        const { TwitterIntegration } = await import("../integrations/platforms/twitter.js");
        const tw = new TwitterIntegration();
        return tw.postVideo(accessToken, videoBuffer, caption);
      }
      case "facebook": {
        const { FacebookIntegration } = await import("../integrations/platforms/facebook.js");
        const fb = new FacebookIntegration();
        return fb.uploadReel(accessToken, videoBuffer, caption, platformUserId);
      }
      case "linkedin": {
        const { LinkedInIntegration } = await import("../integrations/platforms/linkedin.js");
        const li = new LinkedInIntegration();
        return li.createVideoPost(accessToken, videoBuffer, caption, platformUserId);
      }
      case "snapchat": {
        const { SnapchatIntegration } = await import("../integrations/platforms/snapchat.js");
        const snap = new SnapchatIntegration();
        return snap.uploadSpotlight(accessToken, videoBuffer, caption);
      }
      case "pinterest": {
        const { PinterestIntegration } = await import("../integrations/platforms/pinterest.js");
        const pin = new PinterestIntegration();
        return pin.createIdeaPin(accessToken, videoBuffer, caption, platformUserId);
      }
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}
