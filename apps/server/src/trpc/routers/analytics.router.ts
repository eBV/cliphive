import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { router } from "../init.js";
import { protectedProcedure } from "../middleware.js";
import {
  analytics,
  publications,
  renderedClips,
  clips,
  socialAccounts,
} from "@cliphive/db";

export const analyticsRouter = router({
  getForPublication: protectedProcedure
    .input(z.object({ publicationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership via join chain
      const [pub] = await ctx.db
        .select({ id: publications.id })
        .from(publications)
        .innerJoin(
          renderedClips,
          eq(publications.renderedClipId, renderedClips.id)
        )
        .innerJoin(clips, eq(renderedClips.clipId, clips.id))
        .where(
          and(
            eq(publications.id, input.publicationId),
            eq(clips.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!pub) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Publication not found",
        });
      }

      const rows = await ctx.db
        .select()
        .from(analytics)
        .where(eq(analytics.publicationId, input.publicationId))
        .orderBy(desc(analytics.fetchedAt))
        .limit(1);

      return rows[0] ?? null;
    }),

  getAggregated: protectedProcedure
    .input(
      z.object({
        platform: z
          .enum([
            "tiktok",
            "instagram",
            "youtube",
            "twitter",
            "facebook",
            "snapchat",
            "linkedin",
            "pinterest",
          ])
          .optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get user's publication IDs
      const userClips = await ctx.db
        .select({ id: clips.id })
        .from(clips)
        .where(eq(clips.userId, ctx.user.id));

      if (userClips.length === 0) {
        return {
          totalViews: 0,
          totalLikes: 0,
          totalComments: 0,
          totalShares: 0,
          totalSaves: 0,
          avgEngagementRate: 0,
          avgWatchPercentage: 0,
          totalReach: 0,
          topClipId: null,
          platformBreakdown: [],
          timeSeries: [],
        };
      }

      const userClipIds = userClips.map((c) => c.id);
      const userRenderedClips = await ctx.db
        .select({ id: renderedClips.id })
        .from(renderedClips)
        .where(inArray(renderedClips.clipId, userClipIds));

      if (userRenderedClips.length === 0) {
        return {
          totalViews: 0, totalLikes: 0, totalComments: 0, totalShares: 0,
          totalSaves: 0, avgEngagementRate: 0, avgWatchPercentage: 0,
          totalReach: 0, topClipId: null, platformBreakdown: [], timeSeries: [],
        };
      }

      const renderedIds = userRenderedClips.map((r) => r.id);

      const pubsQuery = ctx.db
        .select({ id: publications.id })
        .from(publications)
        .innerJoin(socialAccounts, eq(publications.socialAccountId, socialAccounts.id));

      const userPubs = await (input.platform
        ? pubsQuery.where(
            and(
              inArray(publications.renderedClipId, renderedIds),
              eq(socialAccounts.platform, input.platform)
            )
          )
        : pubsQuery.where(inArray(publications.renderedClipId, renderedIds)));

      if (userPubs.length === 0) {
        return {
          totalViews: 0, totalLikes: 0, totalComments: 0, totalShares: 0,
          totalSaves: 0, avgEngagementRate: 0, avgWatchPercentage: 0,
          totalReach: 0, topClipId: null, platformBreakdown: [], timeSeries: [],
        };
      }

      const pubIds = userPubs.map((p) => p.id);
      const analyticsFilters = [inArray(analytics.publicationId, pubIds)];

      if (input.startDate) {
        analyticsFilters.push(gte(analytics.fetchedAt, new Date(input.startDate)));
      }
      if (input.endDate) {
        analyticsFilters.push(lte(analytics.fetchedAt, new Date(input.endDate)));
      }

      const rows = await ctx.db
        .select()
        .from(analytics)
        .where(and(...analyticsFilters));

      const totalViews = rows.reduce((s, r) => s + r.views, 0);
      const totalLikes = rows.reduce((s, r) => s + r.likes, 0);
      const totalComments = rows.reduce((s, r) => s + r.comments, 0);
      const totalShares = rows.reduce((s, r) => s + r.shares, 0);
      const totalSaves = rows.reduce((s, r) => s + r.saves, 0);
      const totalReach = rows.reduce((s, r) => s + r.reach, 0);
      const avgEngagementRate =
        rows.length > 0
          ? rows.reduce((s, r) => s + r.engagementRate, 0) / rows.length
          : 0;
      const avgWatchPercentage =
        rows.length > 0
          ? rows.reduce((s, r) => s + r.avgWatchPercentage, 0) / rows.length
          : 0;

      return {
        totalViews,
        totalLikes,
        totalComments,
        totalShares,
        totalSaves,
        avgEngagementRate,
        avgWatchPercentage,
        totalReach,
        topClipId: null,
        platformBreakdown: [],
        timeSeries: [],
      };
    }),

  getTopClips: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(20).default(10),
        metric: z
          .enum(["views", "likes", "engagementRate", "shares"])
          .default("views"),
      })
    )
    .query(async ({ ctx, input }) => {
      const userClips = await ctx.db
        .select({ id: clips.id })
        .from(clips)
        .where(eq(clips.userId, ctx.user.id))
        .orderBy(desc(clips.viralityScore))
        .limit(input.limit);

      return userClips;
    }),

  getLeaderboard: protectedProcedure
    .input(
      z.object({
        platform: z
          .enum([
            "tiktok",
            "instagram",
            "youtube",
            "twitter",
            "facebook",
            "snapchat",
            "linkedin",
            "pinterest",
          ])
          .optional(),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      // Return top clips by virality score for the user
      const topClips = await ctx.db
        .select()
        .from(clips)
        .where(eq(clips.userId, ctx.user.id))
        .orderBy(desc(clips.viralityScore))
        .limit(input.limit);

      return topClips;
    }),
});
