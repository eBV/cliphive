import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    DATABASE_URL: process.env.DATABASE_URL?.replace(/:[^@]*@/, ':****@'),
    NODE_ENV: process.env.NODE_ENV,
    cwd: process.cwd(),
  });
}
