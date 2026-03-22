import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { auth } from "../../../../auth";
import { createDb } from "@cliphive/db";
import { users } from "@cliphive/db";
import { eq } from "drizzle-orm";

let _db: ReturnType<typeof createDb> | null = null;
function getDb() {
  if (!_db) _db = createDb(process.env.DATABASE_URL!);
  return _db;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const db = getDb();

    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, session.user.email))
      .limit(1);

    if (!user) {
      [user] = await db
        .insert(users)
        .values({
          email: session.user.email,
          name: session.user.name ?? undefined,
          avatarUrl: session.user.image ?? undefined,
        })
        .returning();
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const token = await new SignJWT({ email: user.email, plan: user.plan })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setExpirationTime("7d")
      .sign(secret);

    return NextResponse.json({ token });
  } catch (e: any) {
    console.error("[token] error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error", stack: e?.stack?.split("\n").slice(0, 5) },
      { status: 500 }
    );
  }
}
