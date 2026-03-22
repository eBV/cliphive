import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, inArray } from "drizzle-orm";
import { router } from "../init.js";
import { protectedProcedure } from "../middleware.js";
import { publications, renderedClips, socialAccounts, clips } from "@cliphive/db";
import { publishQueue } from "../../jobs/queue.js";

export const publishRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        renderedClipId: z.string().uuid(),
        socialAccountId: z.string().uuid(),
        caption: z.string().max(63206),
        hashtags: z.array(z.string()).max(30),
        scheduledAt: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify rendered clip ownership
      const [rc] = await ctx.db
        .select({ id: renderedClips.id, clipId: renderedClips.clipId })
        .from(renderedClips)
        .innerJoin(clips, eq(renderedClips.clipId, clips.id))
        .where(
          and(
            eq(renderedClips.id, input.renderedClipId),
            eq(clips.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!rc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rendered clip not found",
        });
      }

      // Verify social account ownership
      const [account] = await ctx.db
        .select({ id: socialAccounts.id })
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.id, input.socialAccountId),
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

      const [pub] = await ctx.db
        .insert(publications)
        .values({
          renderedClipId: input.renderedClipId,
          socialAccountId: input.socialAccountId,
          caption: input.caption,
          hashtags: input.hashtags,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          status: input.scheduledAt ? "scheduled" : "draft",
        })
        .returning();

      return pub;
    }),

  schedule: protectedProcedure
    .input(
      z.object({
        publicationId: z.string().uuid(),
        scheduledAt: z.string().datetime(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [pub] = await ctx.db
        .select({
          id: publications.id,
          socialAccountId: publications.socialAccountId,
          renderedClipId: publications.renderedClipId,
          status: publications.status,
        })
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

      if (pub.status === "published") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot schedule an already published post",
        });
      }

      const scheduledDate = new Date(input.scheduledAt);
      const delay = scheduledDate.getTime() - Date.now();

      if (delay < 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Scheduled time must be in the future",
        });
      }

      await publishQueue.add(
        "publish",
        { publicationId: input.publicationId, userId: ctx.user.id },
        {
          delay,
          attempts: 3,
          backoff: { type: "exponential", delay: 10000 },
        }
      );

      const [updated] = await ctx.db
        .update(publications)
        .set({ scheduledAt: scheduledDate, status: "scheduled" })
        .where(eq(publications.id, input.publicationId))
        .returning();

      return updated;
    }),

  publish: protectedProcedure
    .input(z.object({ publicationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [pub] = await ctx.db
        .select({ id: publications.id, status: publications.status })
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

      if (pub.status === "published") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Already published",
        });
      }

      await publishQueue.add(
        "publish",
        { publicationId: input.publicationId, userId: ctx.user.id },
        { attempts: 3, backoff: { type: "exponential", delay: 10000 } }
      );

      const [updated] = await ctx.db
        .update(publications)
        .set({ status: "publishing" })
        .where(eq(publications.id, input.publicationId))
        .returning();

      return updated;
    }),

  cancel: protectedProcedure
    .input(z.object({ publicationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [pub] = await ctx.db
        .select({ id: publications.id, status: publications.status })
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
        throw new TRPCError({ code: "NOT_FOUND", message: "Publication not found" });
      }

      if (pub.status === "published") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot cancel a published post",
        });
      }

      // Remove from queue if scheduled
      const jobs = await publishQueue.getJobs(["waiting", "delayed"]);
      for (const job of jobs) {
        if (job.data.publicationId === input.publicationId) {
          await job.remove();
        }
      }

      const [updated] = await ctx.db
        .update(publications)
        .set({ status: "draft", scheduledAt: null })
        .where(eq(publications.id, input.publicationId))
        .returning();

      return updated;
    }),

  listPublications: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        status: z
          .enum(["draft", "scheduled", "publishing", "published", "failed"])
          .optional(),
        socialAccountId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userClips = await ctx.db
        .select({ id: clips.id })
        .from(clips)
        .where(eq(clips.userId, ctx.user.id));

      if (userClips.length === 0) {
        return { items: [], limit: input.limit, offset: input.offset };
      }

      const userClipIds = userClips.map((c) => c.id);

      const userRenderedClips = await ctx.db
        .select({ id: renderedClips.id })
        .from(renderedClips)
        .where(inArray(renderedClips.clipId, userClipIds));

      if (userRenderedClips.length === 0) {
        return { items: [], limit: input.limit, offset: input.offset };
      }

      const renderedIds = userRenderedClips.map((r) => r.id);
      const conditions = [inArray(publications.renderedClipId, renderedIds)];

      if (input.status) {
        conditions.push(eq(publications.status, input.status));
      }
      if (input.socialAccountId) {
        conditions.push(eq(publications.socialAccountId, input.socialAccountId));
      }

      const items = await ctx.db
        .select()
        .from(publications)
        .where(and(...conditions))
        .orderBy(desc(publications.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return { items, limit: input.limit, offset: input.offset };
    }),
});
