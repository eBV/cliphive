import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc } from "drizzle-orm";
import { router } from "../init.js";
import { protectedProcedure } from "../middleware.js";
import { sourceMedia } from "@cliphive/db";
import { MediaIngestionService } from "../../services/media-ingestion.service.js";
import { ingestQueue } from "../../jobs/queue.js";

const ingestionSvc = new MediaIngestionService();

export const mediaRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        status: z
          .enum(["uploading", "transcribing", "analyzing", "ready", "error"])
          .optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(sourceMedia.userId, ctx.user.id)];
      if (input.status) {
        conditions.push(eq(sourceMedia.processingStatus, input.status));
      }

      const items = await ctx.db
        .select()
        .from(sourceMedia)
        .where(and(...conditions))
        .orderBy(desc(sourceMedia.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return { items, limit: input.limit, offset: input.offset };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [item] = await ctx.db
        .select()
        .from(sourceMedia)
        .where(
          and(
            eq(sourceMedia.id, input.id),
            eq(sourceMedia.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Media not found",
        });
      }
      return item;
    }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(500),
        sourceType: z.enum([
          "upload",
          "youtube_url",
          "twitch_vod",
          "podcast_rss",
          "screen_recording",
          "live_stream",
        ]),
        sourceUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(sourceMedia)
        .values({
          userId: ctx.user.id,
          title: input.title,
          sourceType: input.sourceType,
          sourceUrl: input.sourceUrl ?? null,
          processingStatus: "uploading",
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create media record",
        });
      }

      // For URL-based sources, queue ingestion immediately
      if (input.sourceUrl && input.sourceType !== "upload") {
        await ingestQueue.add(
          "ingest",
          {
            mediaId: created.id,
            userId: ctx.user.id,
            sourceUrl: input.sourceUrl,
            sourceType: input.sourceType,
          },
          { attempts: 3, backoff: { type: "exponential", delay: 2000 } }
        );
      }

      return created;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [item] = await ctx.db
        .select({ id: sourceMedia.id, s3Key: sourceMedia.s3Key })
        .from(sourceMedia)
        .where(
          and(
            eq(sourceMedia.id, input.id),
            eq(sourceMedia.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Media not found" });
      }

      // Delete from S3 if key exists
      if (item.s3Key) {
        try {
          const { StorageService } = await import(
            "../../integrations/storage.js"
          );
          const storage = new StorageService();
          await storage.deleteObject(item.s3Key);
        } catch (err) {
          console.error("Failed to delete S3 object:", err);
        }
      }

      await ctx.db
        .delete(sourceMedia)
        .where(eq(sourceMedia.id, input.id));

      return { success: true };
    }),

  getUploadUrl: protectedProcedure
    .input(
      z.object({
        mediaId: z.string().uuid(),
        filename: z.string(),
        contentType: z.string(),
        fileSizeBytes: z.number().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const [item] = await ctx.db
        .select({ id: sourceMedia.id })
        .from(sourceMedia)
        .where(
          and(
            eq(sourceMedia.id, input.mediaId),
            eq(sourceMedia.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Media not found" });
      }

      const { StorageService } = await import("../../integrations/storage.js");
      const storage = new StorageService();
      const key = `media/${ctx.user.id}/${input.mediaId}/original/${input.filename}`;
      const uploadUrl = await storage.getPresignedUploadUrl(
        key,
        input.contentType,
        3600
      );

      return { uploadUrl, key };
    }),

  triggerProcessing: protectedProcedure
    .input(
      z.object({
        mediaId: z.string().uuid(),
        s3Key: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [item] = await ctx.db
        .select()
        .from(sourceMedia)
        .where(
          and(
            eq(sourceMedia.id, input.mediaId),
            eq(sourceMedia.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Media not found" });
      }

      // Update s3Key and status
      await ctx.db
        .update(sourceMedia)
        .set({ s3Key: input.s3Key, processingStatus: "transcribing" })
        .where(eq(sourceMedia.id, input.mediaId));

      await ingestionSvc.triggerProcessingPipeline(input.mediaId, ctx.user.id);

      return { success: true, mediaId: input.mediaId };
    }),
});
