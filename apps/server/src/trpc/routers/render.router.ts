import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, inArray, desc } from "drizzle-orm";
import { router } from "../init.js";
import { protectedProcedure } from "../middleware.js";
import { clips, renderedClips } from "@cliphive/db";
import { renderQueue } from "../../jobs/queue.js";

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

export const renderRouter = router({
  triggerRender: protectedProcedure
    .input(
      z.object({
        clipId: z.string().uuid(),
        platforms: z.array(platformEnum).min(1),
        priority: z.number().min(1).max(10).default(5),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [clip] = await ctx.db
        .select({ id: clips.id, status: clips.status })
        .from(clips)
        .where(
          and(eq(clips.id, input.clipId), eq(clips.userId, ctx.user.id))
        )
        .limit(1);

      if (!clip) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Clip not found" });
      }

      const jobs = input.platforms.map((platform) => ({
        name: "render",
        data: {
          clipId: input.clipId,
          platform,
          userId: ctx.user.id,
        },
        opts: {
          priority: input.priority,
          attempts: 3,
          backoff: { type: "exponential" as const, delay: 5000 },
        },
      }));

      await renderQueue.addBulk(jobs);

      await ctx.db
        .update(clips)
        .set({ status: "queued" })
        .where(eq(clips.id, input.clipId));

      return {
        success: true,
        jobCount: jobs.length,
        platforms: input.platforms,
      };
    }),

  getRenderStatus: protectedProcedure
    .input(z.object({ clipId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [clip] = await ctx.db
        .select({ id: clips.id, status: clips.status })
        .from(clips)
        .where(
          and(eq(clips.id, input.clipId), eq(clips.userId, ctx.user.id))
        )
        .limit(1);

      if (!clip) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Clip not found" });
      }

      const rendered = await ctx.db
        .select()
        .from(renderedClips)
        .where(eq(renderedClips.clipId, input.clipId))
        .orderBy(desc(renderedClips.renderedAt));

      // Get queue job status for pending renders
      const waiting = await renderQueue.getJobs(["waiting", "active"]);
      const pendingPlatforms = waiting
        .filter((j) => j.data.clipId === input.clipId)
        .map((j) => j.data.platform as string);

      return {
        clipStatus: clip.status,
        renderedClips: rendered,
        pendingPlatforms,
      };
    }),

  listRendered: protectedProcedure
    .input(
      z.object({
        clipId: z.string().uuid().optional(),
        platform: platformEnum.optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      // Join with clips to enforce user ownership
      const userClipIds = await ctx.db
        .select({ id: clips.id })
        .from(clips)
        .where(eq(clips.userId, ctx.user.id));

      const clipIds = userClipIds.map((c) => c.id);
      if (clipIds.length === 0) return { items: [], limit: input.limit, offset: input.offset };

      const conditions = [inArray(renderedClips.clipId, clipIds)];
      if (input.clipId) {
        conditions.push(eq(renderedClips.clipId, input.clipId));
      }
      if (input.platform) {
        conditions.push(eq(renderedClips.platform, input.platform));
      }

      const items = await ctx.db
        .select()
        .from(renderedClips)
        .where(and(...conditions))
        .orderBy(desc(renderedClips.renderedAt))
        .limit(input.limit)
        .offset(input.offset);

      return { items, limit: input.limit, offset: input.offset };
    }),
});
