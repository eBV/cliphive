import { eq, inArray } from "drizzle-orm";
import { createDb, analytics, publications, socialAccounts } from "@cliphive/db";
import type { Platform } from "@cliphive/shared";
import { config } from "../config.js";
import { CryptoService } from "../utils/crypto.js";
import { withRetry, CircuitBreaker } from "../utils/retry.js";

interface PlatformMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watchTimeSeconds: number;
  avgWatchPercentage: number;
  reach: number;
  engagementRate: number;
}

export class AnalyticsFetcherService {
  private readonly db: ReturnType<typeof createDb>;
  private readonly crypto: CryptoService;
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor() {
    this.db = createDb(config.DATABASE_URL);
    this.crypto = new CryptoService();
  }

  private getBreaker(platform: string): CircuitBreaker {
    let b = this.breakers.get(platform);
    if (!b) {
      b = new CircuitBreaker(5, 300000);
      this.breakers.set(platform, b);
    }
    return b;
  }

  async fetchForPublication(publicationId: string): Promise<void> {
    const [pub] = await this.db
      .select()
      .from(publications)
      .where(eq(publications.id, publicationId))
      .limit(1);

    if (!pub || !pub.platformPostId) {
      console.warn(`[Analytics] Publication ${publicationId} not found or no platformPostId`);
      return;
    }

    const [account] = await this.db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, pub.socialAccountId))
      .limit(1);

    if (!account || !account.accessToken) {
      console.warn(`[Analytics] No account or token for publication ${publicationId}`);
      return;
    }

    const accessToken = this.crypto.decrypt(account.accessToken);
    const platform = account.platform as Platform;

    let metrics: PlatformMetrics;
    try {
      metrics = await withRetry(
        () =>
          this.getBreaker(platform).execute(() =>
            this.fetchFromPlatform(
              platform,
              accessToken,
              pub.platformPostId!,
              account.platformUserId
            )
          ),
        { attempts: 3, delayMs: 3000, backoff: "exponential" }
      );
    } catch (err) {
      console.error(`[Analytics] Failed to fetch for publication ${publicationId}:`, err);
      return;
    }

    // Upsert analytics record
    await this.db
      .insert(analytics)
      .values({
        publicationId,
        views: metrics.views,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        saves: metrics.saves,
        watchTimeSeconds: metrics.watchTimeSeconds,
        avgWatchPercentage: metrics.avgWatchPercentage,
        reach: metrics.reach,
        engagementRate: metrics.engagementRate,
        fetchedAt: new Date(),
      });

    console.info(`[Analytics] Fetched metrics for publication ${publicationId} on ${platform}`);
  }

  async fetchAllPublished(userId: string): Promise<void> {
    const userAccounts = await this.db
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(eq(socialAccounts.userId, userId));

    if (userAccounts.length === 0) return;

    const accountIds = userAccounts.map((a) => a.id);
    const publishedPubs = await this.db
      .select({ id: publications.id })
      .from(publications)
      .where(
        inArray(publications.socialAccountId, accountIds)
      );

    for (const pub of publishedPubs) {
      await this.fetchForPublication(pub.id);
    }
  }

  private async fetchFromPlatform(
    platform: Platform,
    accessToken: string,
    postId: string,
    platformUserId: string
  ): Promise<PlatformMetrics> {
    switch (platform) {
      case "tiktok": {
        const { TikTokIntegration } = await import("../integrations/platforms/tiktok.js");
        return new TikTokIntegration().getVideoAnalytics(accessToken, postId);
      }
      case "instagram": {
        const { InstagramIntegration } = await import("../integrations/platforms/instagram.js");
        return new InstagramIntegration().getInsights(accessToken, postId);
      }
      case "youtube": {
        const { YouTubeIntegration } = await import("../integrations/platforms/youtube.js");
        return new YouTubeIntegration().getVideoStats(accessToken, postId);
      }
      case "twitter": {
        const { TwitterIntegration } = await import("../integrations/platforms/twitter.js");
        return new TwitterIntegration().getTweetMetrics(accessToken, postId);
      }
      case "facebook": {
        const { FacebookIntegration } = await import("../integrations/platforms/facebook.js");
        return new FacebookIntegration().getInsights(accessToken, postId, platformUserId);
      }
      case "linkedin": {
        const { LinkedInIntegration } = await import("../integrations/platforms/linkedin.js");
        return new LinkedInIntegration().getPostStats(accessToken, postId);
      }
      default:
        return {
          views: 0, likes: 0, comments: 0, shares: 0, saves: 0,
          watchTimeSeconds: 0, avgWatchPercentage: 0, reach: 0, engagementRate: 0,
        };
    }
  }
}
