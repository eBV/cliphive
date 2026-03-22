import { z } from "zod";
import { eq, and, desc, gte } from "drizzle-orm";
import { router } from "../init.js";
import { protectedProcedure } from "../middleware.js";
import { trendingSounds, trendingHashtags, clips } from "@cliphive/db";

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

export const trendingRouter = router({
  getSounds: protectedProcedure
    .input(
      z.object({
        platform: platformEnum,
        limit: z.number().min(1).max(50).default(20),
        freshnessHours: z.number().min(1).max(72).default(24),
      })
    )
    .query(async ({ ctx, input }) => {
      const cutoff = new Date(
        Date.now() - input.freshnessHours * 60 * 60 * 1000
      );

      const sounds = await ctx.db
        .select()
        .from(trendingSounds)
        .where(
          and(
            eq(trendingSounds.platform, input.platform),
            gte(trendingSounds.fetchedAt, cutoff)
          )
        )
        .orderBy(trendingSounds.trendingRank)
        .limit(input.limit);

      return sounds;
    }),

  getHashtags: protectedProcedure
    .input(
      z.object({
        platform: platformEnum,
        category: z.string().optional(),
        limit: z.number().min(1).max(100).default(30),
        freshnessHours: z.number().min(1).max(72).default(12),
      })
    )
    .query(async ({ ctx, input }) => {
      const cutoff = new Date(
        Date.now() - input.freshnessHours * 60 * 60 * 1000
      );

      const conditions = [
        eq(trendingHashtags.platform, input.platform),
        gte(trendingHashtags.fetchedAt, cutoff),
      ];

      if (input.category) {
        conditions.push(eq(trendingHashtags.category, input.category));
      }

      const hashtags = await ctx.db
        .select()
        .from(trendingHashtags)
        .where(and(...conditions))
        .orderBy(desc(trendingHashtags.volume))
        .limit(input.limit);

      return hashtags;
    }),

  getSuggested: protectedProcedure
    .input(
      z.object({
        clipId: z.string().uuid(),
        platforms: z.array(platformEnum).min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const { TrendingService } = await import(
        "../../services/trending.service.js"
      );
      const svc = new TrendingService();

      const [clip] = await ctx.db
        .select()
        .from(clips)
        .where(eq(clips.id, input.clipId))
        .limit(1);

      if (!clip) {
        return { sounds: [], hashtags: [] };
      }

      const suggestions = await svc.getSuggestionsForClip(
        clip,
        input.platforms
      );

      return suggestions;
    }),
});
