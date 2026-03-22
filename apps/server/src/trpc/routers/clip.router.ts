import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, gte, lte, inArray } from "drizzle-orm";
import { router } from "../init.js";
import { protectedProcedure } from "../middleware.js";
import { clips } from "@cliphive/db";
import { detectClipsQueue, renderQueue } from "../../jobs/queue.js";

export const clipRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        sourceMediaId: z.string().uuid().optional(),
        status: z
          .enum([
            "detected",
            "queued",
            "rendering",
            "rendered",
            "published",
            "failed",
          ])
          .optional(),
        minViralityScore: z.number().min(0).max(1).optional(),
        maxViralityScore: z.number().min(0).max(1).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(clips.userId, ctx.user.id)];

      if (input.sourceMediaId) {
        conditions.push(eq(clips.sourceMediaId, input.sourceMediaId));
      }
      if (input.status) {
        conditions.push(eq(clips.status, input.status));
      }
      if (input.minViralityScore !== undefined) {
        conditions.push(gte(clips.viralityScore, input.minViralityScore));
      }
      if (input.maxViralityScore !== undefined) {
        conditions.push(lte(clips.viralityScore, input.maxViralityScore));
      }

      const items = await ctx.db
        .select()
        .from(clips)
        .where(and(...conditions))
        .orderBy(desc(clips.viralityScore), desc(clips.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return { items, limit: input.limit, offset: input.offset };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [clip] = await ctx.db
        .select()
        .from(clips)
        .where(and(eq(clips.id, input.id), eq(clips.userId, ctx.user.id)))
        .limit(1);

      if (!clip) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Clip not found" });
      }
      return clip;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(500).optional(),
        templateId: z.string().uuid().nullable().optional(),
        overlayConfig: z
          .object({
            captionStyle: z.enum([
              "tiktok_classic",
              "hormozi",
              "minimal",
              "karaoke",
              "typewriter",
            ]),
            template: z.string(),
            zoomKeyframes: z.array(
              z.object({
                time: z.number(),
                scale: z.number(),
                x: z.number(),
                y: z.number(),
              })
            ),
            watermark: z.boolean(),
            ctaText: z.string().optional(),
            emojiReactions: z.boolean(),
            progressBar: z.boolean(),
            backgroundMusic: z
              .object({
                soundId: z.string(),
                volume: z.number(),
                fadeIn: z.number(),
                fadeOut: z.number(),
              })
              .optional(),
          })
          .nullable()
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const [existing] = await ctx.db
        .select({ id: clips.id })
        .from(clips)
        .where(and(eq(clips.id, id), eq(clips.userId, ctx.user.id)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Clip not found" });
      }

      const updatePayload: Partial<typeof clips.$inferInsert> = {};
      if (updates.title !== undefined) updatePayload.title = updates.title;
      if (updates.templateId !== undefined)
        updatePayload.templateId = updates.templateId ?? null;
      if (updates.overlayConfig !== undefined)
        updatePayload.overlayConfig = updates.overlayConfig;

      const [updated] = await ctx.db
        .update(clips)
        .set(updatePayload)
        .where(eq(clips.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ id: clips.id })
        .from(clips)
        .where(and(eq(clips.id, input.id), eq(clips.userId, ctx.user.id)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Clip not found" });
      }

      await ctx.db.delete(clips).where(eq(clips.id, input.id));
      return { success: true };
    }),

  triggerDetection: protectedProcedure
    .input(z.object({ mediaId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await detectClipsQueue.add(
        "detect-clips",
        {
          mediaId: input.mediaId,
          userId: ctx.user.id,
        },
        { attempts: 3, backoff: { type: "exponential", delay: 3000 } }
      );
      return { success: true, mediaId: input.mediaId };
    }),

  rescore: protectedProcedure
    .input(z.object({ clipId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [clip] = await ctx.db
        .select()
        .from(clips)
        .where(and(eq(clips.id, input.clipId), eq(clips.userId, ctx.user.id)))
        .limit(1);

      if (!clip) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Clip not found" });
      }

      const { ClipDetectionService } = await import(
        "../../services/clip-detection.service.js"
      );
      const svc = new ClipDetectionService();
      const score = await svc.rescoreClip(clip.id, clip.sourceMediaId);

      await ctx.db
        .update(clips)
        .set({
          viralityScore: score.overall,
          hookScore: score.hookScore,
          energyScore: score.audioEnergyScore,
        })
        .where(eq(clips.id, input.clipId));

      return { success: true, score };
    }),

  bulkQueue: protectedProcedure
    .input(
      z.object({
        clipIds: z.array(z.string().uuid()).min(1).max(50),
        platforms: z.array(
          z.enum([
            "tiktok",
            "instagram",
            "youtube",
            "twitter",
            "facebook",
            "snapchat",
            "linkedin",
            "pinterest",
          ])
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userClips = await ctx.db
        .select({ id: clips.id })
        .from(clips)
        .where(
          and(
            inArray(clips.id, input.clipIds),
            eq(clips.userId, ctx.user.id)
          )
        );

      const foundIds = userClips.map((c) => c.id);
      const missing = input.clipIds.filter((id) => !foundIds.includes(id));

      if (missing.length > 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Clips not found: ${missing.join(", ")}`,
        });
      }

      const jobs = foundIds.flatMap((clipId) =>
        input.platforms.map((platform) => ({
          name: "render",
          data: { clipId, platform, userId: ctx.user.id },
          opts: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
        }))
      );

      await renderQueue.addBulk(jobs);

      // Update status to queued
      await ctx.db
        .update(clips)
        .set({ status: "queued" })
        .where(inArray(clips.id, foundIds));

      return { success: true, queued: foundIds.length * input.platforms.length };
    }),
});
