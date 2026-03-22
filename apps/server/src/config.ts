import { z } from "zod";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../../../.env") });

const configSchema = z.object({
  // Server
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // Encryption
  ENCRYPTION_KEY: z.string().min(32),

  // AWS / Cloudflare R2
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),
  AWS_REGION: z.string().default("auto"),
  AWS_S3_BUCKET: z.string(),
  AWS_S3_ENDPOINT: z.string().url().optional(),
  CDN_BASE_URL: z.string().url(),

  // ML Service
  ML_SERVICE_URL: z.string().url().default("http://localhost:8000"),
  ML_API_KEY: z.string().optional(),

  // Remotion Lambda
  REMOTION_AWS_ACCESS_KEY_ID: z.string().optional(),
  REMOTION_AWS_SECRET_ACCESS_KEY: z.string().optional(),
  REMOTION_FUNCTION_NAME: z.string().optional(),
  REMOTION_S3_BUCKET: z.string().optional(),
  REMOTION_REGION: z.string().default("us-east-1"),

  // TikTok
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: z.string().url().optional(),

  // Instagram / Facebook
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  INSTAGRAM_REDIRECT_URI: z.string().url().optional(),
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),
  FACEBOOK_REDIRECT_URI: z.string().url().optional(),

  // YouTube
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z.string().url().optional(),

  // Twitter / X
  TWITTER_CLIENT_ID: z.string().optional(),
  TWITTER_CLIENT_SECRET: z.string().optional(),
  TWITTER_REDIRECT_URI: z.string().url().optional(),

  // LinkedIn
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_REDIRECT_URI: z.string().url().optional(),

  // Snapchat
  SNAPCHAT_CLIENT_ID: z.string().optional(),
  SNAPCHAT_CLIENT_SECRET: z.string().optional(),
  SNAPCHAT_REDIRECT_URI: z.string().url().optional(),

  // Pinterest
  PINTEREST_APP_ID: z.string().optional(),
  PINTEREST_APP_SECRET: z.string().optional(),
  PINTEREST_REDIRECT_URI: z.string().url().optional(),

  // Cloudflare CDN
  CLOUDFLARE_ZONE_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),

  // Resend email
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default("noreply@cliphive.app"),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),

  // Virality
  VIRALITY_AUTO_APPROVE_THRESHOLD: z.coerce.number().default(0.72),
  VIRALITY_SUGGEST_THRESHOLD: z.coerce.number().default(0.55),
  VIRALITY_DISCARD_THRESHOLD: z.coerce.number().default(0.40),
});

function parseConfig() {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment configuration:");
    for (const err of result.error.errors) {
      console.error(`  ${err.path.join(".")}: ${err.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = parseConfig();
export type Config = typeof config;
