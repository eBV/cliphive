import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { router } from "../init.js";
import { protectedProcedure } from "../middleware.js";
import { users } from "@cliphive/db";

export const userRouter = router({
  getMe: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        plan: users.plan,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);

    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }

    return user;
  }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255).optional(),
        avatarUrl: z.string().url().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updatePayload: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updatePayload.name = input.name;
      if (input.avatarUrl !== undefined) updatePayload.avatarUrl = input.avatarUrl;

      const [updated] = await ctx.db
        .update(users)
        .set(updatePayload)
        .where(eq(users.id, ctx.user.id))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          avatarUrl: users.avatarUrl,
          plan: users.plan,
          updatedAt: users.updatedAt,
        });

      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update profile",
        });
      }

      return updated;
    }),

  generateApiKey: protectedProcedure.mutation(async ({ ctx }) => {
    const apiKey = `ch_${randomBytes(32).toString("hex")}`;

    await ctx.db
      .update(users)
      .set({ apiKey, updatedAt: new Date() })
      .where(eq(users.id, ctx.user.id));

    return { apiKey };
  }),

  revokeApiKey: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(users)
      .set({ apiKey: null, updatedAt: new Date() })
      .where(eq(users.id, ctx.user.id));

    return { success: true };
  }),
});
