import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, or, desc } from "drizzle-orm";
import { router } from "../init.js";
import { protectedProcedure } from "../middleware.js";
import { templates } from "@cliphive/db";

const templateConfigSchema = z.object({
  layout: z.enum([
    "fullscreen",
    "split_vertical_60_40",
    "split_horizontal",
    "picture_in_picture",
    "side_by_side",
  ]),
  captionStyle: z.string(),
  captionPosition: z.enum(["top", "center", "bottom"]),
  zoomBehavior: z.enum(["static", "auto_face_track", "ken_burns", "custom"]),
  transitionType: z.enum(["cut", "fade", "slide", "zoom"]),
  brandColors: z.object({
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
    background: z.string(),
    text: z.string(),
  }),
  musicSlot: z.boolean(),
  watermark: z
    .object({
      text: z.string().optional(),
      logoUrl: z.string().optional(),
      position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
      opacity: z.number().min(0).max(1),
    })
    .nullable(),
  letterbox: z.boolean(),
  colorGrade: z
    .enum(["teal_orange", "desaturated", "high_contrast", "warm", "cool", "none"])
    .nullable(),
  progressBar: z.boolean(),
  ctaTemplate: z.string().nullable(),
});

export const templateRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        category: z
          .enum([
            "talking_head",
            "gameplay",
            "podcast",
            "tutorial",
            "reaction",
            "meme",
            "cinematic",
            "text_story",
          ])
          .optional(),
        includeSystem: z.boolean().default(true),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.db
        .select()
        .from(templates)
        .where(
          and(
            input.category ? eq(templates.category, input.category) : undefined,
            input.includeSystem
              ? or(eq(templates.isSystem, true), eq(templates.userId, ctx.user.id))
              : eq(templates.userId, ctx.user.id)
          )
        )
        .orderBy(desc(templates.viralityAvg), desc(templates.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return { items, limit: input.limit, offset: input.offset };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [template] = await ctx.db
        .select()
        .from(templates)
        .where(
          and(
            eq(templates.id, input.id),
            or(eq(templates.isSystem, true), eq(templates.userId, ctx.user.id))
          )
        )
        .limit(1);

      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }
      return template;
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        category: z.enum([
          "talking_head",
          "gameplay",
          "podcast",
          "tutorial",
          "reaction",
          "meme",
          "cinematic",
          "text_story",
        ]),
        remotionCompositionId: z.string().min(1),
        config: templateConfigSchema,
        thumbnailUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(templates)
        .values({
          name: input.name,
          category: input.category,
          remotionCompositionId: input.remotionCompositionId,
          config: input.config,
          thumbnailUrl: input.thumbnailUrl ?? null,
          isSystem: false,
          userId: ctx.user.id,
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create template",
        });
      }

      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        config: templateConfigSchema.optional(),
        thumbnailUrl: z.string().url().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const [existing] = await ctx.db
        .select({ id: templates.id, isSystem: templates.isSystem, userId: templates.userId })
        .from(templates)
        .where(eq(templates.id, id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      }

      if (existing.isSystem || existing.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot modify system templates or templates owned by others",
        });
      }

      const updatePayload: Partial<typeof templates.$inferInsert> = {};
      if (updates.name !== undefined) updatePayload.name = updates.name;
      if (updates.config !== undefined) updatePayload.config = updates.config;
      if (updates.thumbnailUrl !== undefined)
        updatePayload.thumbnailUrl = updates.thumbnailUrl;

      const [updated] = await ctx.db
        .update(templates)
        .set(updatePayload)
        .where(eq(templates.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ id: templates.id, isSystem: templates.isSystem, userId: templates.userId })
        .from(templates)
        .where(eq(templates.id, input.id))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      }

      if (existing.isSystem || existing.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot delete system templates",
        });
      }

      await ctx.db.delete(templates).where(eq(templates.id, input.id));
      return { success: true };
    }),
});
