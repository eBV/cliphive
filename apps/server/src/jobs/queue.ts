import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config.js";

// Shared Redis connection for all queues (Read/Write only, not for blocking commands)
export const redisConnection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

/**
 * Creates a dedicated Redis connection for BullMQ workers.
 * BullMQ workers require their own connection instance for blocking commands.
 */
export function createWorkerConnection(): any {
  return new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

redisConnection.on("error", (err) => {
  console.error("[Redis] Connection error:", err.message);
});

redisConnection.on("connect", () => {
  console.info("[Redis] Connected");
});

const defaultQueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
};

// ── Queue Definitions ─────────────────────────────────────────────────

/** Media ingestion: download from URL, upload to S3 */
// @ts-expect-error - version mismatch
export const ingestQueue = new Queue("ingest", defaultQueueOptions);

/** Transcription: call ML /transcribe, save transcript + segments */
// @ts-expect-error - version mismatch
export const transcribeQueue = new Queue("transcribe", defaultQueueOptions);

/** Scene analysis: call ML /detect-scenes, save scene graph */
// @ts-expect-error - version mismatch
export const analyzeQueue = new Queue("analyze", defaultQueueOptions);

/** Clip detection: find viral moments in transcribed + analyzed media */
// @ts-expect-error - version mismatch
export const detectClipsQueue = new Queue("detect-clips", defaultQueueOptions);

/** Rendering: produce platform-optimized MP4 via Remotion Lambda or FFmpeg */
// @ts-expect-error - version mismatch
export const renderQueue = new Queue("render", defaultQueueOptions);

/** Publishing: post rendered clips to social platforms */
// @ts-expect-error - version mismatch
export const publishQueue = new Queue("publish", defaultQueueOptions);

/** Analytics: poll platform APIs for post metrics */
// @ts-expect-error - version mismatch
export const analyticsQueue = new Queue("fetch-analytics", defaultQueueOptions);

/** Trending: refresh trending sounds and hashtags */
// @ts-expect-error - version mismatch
export const trendingQueue = new Queue("fetch-trending", defaultQueueOptions);

/** Virality retraining: aggregate feedback and call ML /retrain */
// @ts-expect-error - version mismatch
export const retrainQueue = new Queue("retrain", defaultQueueOptions);

export const ALL_QUEUES = [
  ingestQueue,
  transcribeQueue,
  analyzeQueue,
  detectClipsQueue,
  renderQueue,
  publishQueue,
  analyticsQueue,
  trendingQueue,
  retrainQueue,
] as const;
