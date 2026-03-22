import { TRPCError } from "@trpc/server";
import { t } from "./init.js";
import { eq } from "drizzle-orm";
import { users } from "@cliphive/db";
import type { User } from "./context.js";

// ── Authenticated middleware ───────────────────────────────────────────
export const authMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    // Try API key fallback
    const apiKey = ctx.req.headers["x-api-key"];
    if (typeof apiKey === "string" && apiKey.length > 0) {
      const [dbUser] = await ctx.db
        .select({
          id: users.id,
          email: users.email,
          plan: users.plan,
          apiKey: users.apiKey,
        })
        .from(users)
        .where(eq(users.apiKey, apiKey))
        .limit(1);

      if (!dbUser) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid API key",
        });
      }

      const authedUser: User = {
        id: dbUser.id,
        email: dbUser.email,
        plan: dbUser.plan,
      };

      return next({
        ctx: { ...ctx, user: authedUser },
      });
    }

    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

// ── Plan-based authorization middleware ───────────────────────────────
export function requirePlan(...plans: Array<"free" | "pro" | "agency">) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    if (!plans.includes(ctx.user.plan)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This feature requires one of: ${plans.join(", ")}`,
      });
    }
    return next({ ctx });
  });
}

// ── Rate-limit middleware (per-procedure additional limiting) ─────────
export function rateLimitMiddleware(maxPerMinute: number) {
  const store = new Map<string, { count: number; resetAt: number }>();

  return t.middleware(async ({ ctx, next }) => {
    const key = `${ctx.user?.id ?? ctx.req.ip}`;
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt < now) {
      store.set(key, { count: 1, resetAt: now + 60_000 });
    } else {
      entry.count += 1;
      if (entry.count > maxPerMinute) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Rate limit exceeded. Max ${maxPerMinute} requests per minute.`,
        });
      }
    }

    return next({ ctx });
  });
}

// ── Logging middleware ─────────────────────────────────────────────────
export const loggingMiddleware = t.middleware(async ({ path, type, next }) => {
  const start = Date.now();
  const result = await next();
  const ms = Date.now() - start;
  console.info(`[tRPC] ${type} ${path} — ${ms}ms`);
  return result;
});

// ── Protected procedure shortcuts ─────────────────────────────────────
export const protectedProcedure = t.procedure
  .use(loggingMiddleware)
  .use(authMiddleware);

export const proProcedure = t.procedure
  .use(loggingMiddleware)
  .use(authMiddleware)
  .use(requirePlan("pro", "agency"));

export const agencyProcedure = t.procedure
  .use(loggingMiddleware)
  .use(authMiddleware)
  .use(requirePlan("agency"));
