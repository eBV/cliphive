import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { router } from "../init.js";
import { protectedProcedure } from "../middleware.js";
import { socialAccounts } from "@cliphive/db";
import { CryptoService } from "../../utils/crypto.js";

const platformEnum = z.enum([
  "tiktok",
  "instagram",
  "youtube",
  "twitter",
  "facebook",
  "snapchat",
  "linkedin",
  "pinterest",
]);

const OAUTH_REDIRECT_BASES: Record<string, string> = {
  tiktok: "https://www.tiktok.com/v2/auth/authorize",
  instagram: "https://api.instagram.com/oauth/authorize",
  youtube: "https://accounts.google.com/o/oauth2/v2/auth",
  twitter: "https://twitter.com/i/oauth2/authorize",
  facebook: "https://www.facebook.com/v21.0/dialog/oauth",
  snapchat: "https://accounts.snapchat.com/accounts/oauth2/auth",
  linkedin: "https://www.linkedin.com/oauth/v2/authorization",
  pinterest: "https://www.pinterest.com/oauth",
};

const OAUTH_SCOPES: Record<string, string> = {
  tiktok: "user.info.basic,video.upload,video.list",
  instagram: "instagram_basic,instagram_content_publish,pages_read_engagement",
  youtube: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
  twitter: "tweet.read tweet.write users.read offline.access media.write",
  facebook: "pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish",
  snapchat: "snapchat-marketing-api",
  linkedin: "r_liteprofile w_member_social",
  pinterest: "boards:read pins:read pins:write user_accounts:read",
};

export const accountRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await ctx.db
      .select({
        id: socialAccounts.id,
        platform: socialAccounts.platform,
        platformUserId: socialAccounts.platformUserId,
        username: socialAccounts.username,
        followerCount: socialAccounts.followerCount,
        connectedAt: socialAccounts.connectedAt,
        tokenExpiresAt: socialAccounts.tokenExpiresAt,
      })
      .from(socialAccounts)
      .where(eq(socialAccounts.userId, ctx.user.id));

    return accounts;
  }),

  connect: protectedProcedure
    .input(
      z.object({
        platform: platformEnum,
        redirectUri: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { config } = await import("../../config.js");

      const clientIds: Record<string, string | undefined> = {
        tiktok: config.TIKTOK_CLIENT_KEY,
        instagram: config.INSTAGRAM_APP_ID,
        youtube: config.YOUTUBE_CLIENT_ID,
        twitter: config.TWITTER_CLIENT_ID,
        facebook: config.FACEBOOK_APP_ID,
        snapchat: config.SNAPCHAT_CLIENT_ID,
        linkedin: config.LINKEDIN_CLIENT_ID,
        pinterest: config.PINTEREST_APP_ID,
      };

      const clientId = clientIds[input.platform];
      if (!clientId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${input.platform} OAuth not configured`,
        });
      }

      const state = Buffer.from(
        JSON.stringify({ userId: ctx.user.id, platform: input.platform, ts: Date.now() })
      ).toString("base64url");

      const base = OAUTH_REDIRECT_BASES[input.platform]!;
      const scope = OAUTH_SCOPES[input.platform]!;

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: input.redirectUri,
        response_type: "code",
        scope,
        state,
      });

      return { authUrl: `${base}?${params.toString()}`, state };
    }),

  disconnect: protectedProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [account] = await ctx.db
        .select({ id: socialAccounts.id })
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.id, input.accountId),
            eq(socialAccounts.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Social account not found",
        });
      }

      await ctx.db
        .delete(socialAccounts)
        .where(eq(socialAccounts.id, input.accountId));

      return { success: true };
    }),

  refresh: protectedProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [account] = await ctx.db
        .select()
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.id, input.accountId),
            eq(socialAccounts.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Social account not found",
        });
      }

      if (!account.refreshToken) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No refresh token available",
        });
      }

      const crypto = new CryptoService();
      const decryptedRefreshToken = crypto.decrypt(account.refreshToken);

      // Dynamic import of platform integration
      let newTokens: { accessToken: string; refreshToken?: string; expiresAt?: Date };

      try {
        switch (account.platform) {
          case "tiktok": {
            const { TikTokIntegration } = await import("../../integrations/platforms/tiktok.js");
            const tk = new TikTokIntegration();
            newTokens = await tk.refreshToken(decryptedRefreshToken);
            break;
          }
          case "instagram":
          case "facebook": {
            const { InstagramIntegration } = await import("../../integrations/platforms/instagram.js");
            const ig = new InstagramIntegration();
            newTokens = await ig.refreshToken(decryptedRefreshToken);
            break;
          }
          case "youtube": {
            const { YouTubeIntegration } = await import("../../integrations/platforms/youtube.js");
            const yt = new YouTubeIntegration();
            newTokens = await yt.refreshToken(decryptedRefreshToken);
            break;
          }
          case "twitter": {
            const { TwitterIntegration } = await import("../../integrations/platforms/twitter.js");
            const tw = new TwitterIntegration();
            newTokens = await tw.refreshToken(decryptedRefreshToken);
            break;
          }
          case "linkedin": {
            const { LinkedInIntegration } = await import("../../integrations/platforms/linkedin.js");
            const li = new LinkedInIntegration();
            newTokens = await li.refreshToken(decryptedRefreshToken);
            break;
          }
          default:
            throw new TRPCError({
              code: "NOT_IMPLEMENTED",
              message: `Token refresh not supported for ${account.platform}`,
            });
        }
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to refresh token: ${(err as Error).message}`,
        });
      }

      await ctx.db
        .update(socialAccounts)
        .set({
          accessToken: crypto.encrypt(newTokens.accessToken),
          refreshToken: newTokens.refreshToken
            ? crypto.encrypt(newTokens.refreshToken)
            : account.refreshToken,
          tokenExpiresAt: newTokens.expiresAt ?? null,
        })
        .where(eq(socialAccounts.id, input.accountId));

      return { success: true };
    }),
});
