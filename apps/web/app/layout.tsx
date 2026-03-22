import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../styles/globals.css";
import { Providers } from "./providers";
import { auth } from "../auth";
import { SignJWT } from "jose";
import { createDb, users } from "@cliphive/db";
import { eq } from "drizzle-orm";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ClipHive — Viral Clip Engine",
  description:
    "Turn any long-form content into viral short-form clips. AI-powered clip detection, auto-captioning, and one-click multi-platform publishing.",
  openGraph: {
    title: "ClipHive — Viral Clip Engine",
    description: "Engineered virality. Every clip, every platform.",
    type: "website",
  },
};

async function getApiToken(): Promise<string | null> {
  try {
    const session = await auth();
    if (!session?.user?.email) return null;

    const db = createDb(process.env.DATABASE_URL!);
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
    return await new SignJWT({ email: user.email, plan: user.plan })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setExpirationTime("7d")
      .sign(secret);
  } catch {
    return null;
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const apiToken = await getApiToken();

  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <Providers apiToken={apiToken}>{children}</Providers>
      </body>
    </html>
  );
}
