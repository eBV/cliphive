import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { createDb } from "@cliphive/db";
import type { Db } from "@cliphive/db";

export interface User {
  id: string;
  email: string;
  plan: "free" | "pro" | "agency";
}

export interface Context {
  req: FastifyRequest;
  res: FastifyReply;
  db: Db;
  user: User | null;
}

let _db: Db | null = null;
function getDb(): Db {
  if (!_db) {
    _db = createDb(config.DATABASE_URL);
  }
  return _db;
}

function extractUser(req: FastifyRequest): User | null {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
      if (
        typeof payload.sub === "string" &&
        typeof payload.email === "string" &&
        typeof payload.plan === "string"
      ) {
        return {
          id: payload.sub,
          email: payload.email,
          plan: payload.plan as User["plan"],
        };
      }
    }

    // Also support API key auth via x-api-key header
    const apiKey = req.headers["x-api-key"];
    if (typeof apiKey === "string" && apiKey.length > 0) {
      // API key verification done in auth middleware
      return null;
    }
  } catch {
    // Token invalid or expired
  }
  return null;
}

export async function createContext({
  req,
  res,
}: {
  req: FastifyRequest;
  res: FastifyReply;
}): Promise<Context> {
  const db = getDb();
  const user = extractUser(req);
  return { req, res, db, user };
}
