import { Worker, type Job } from "bullmq";
import axios from "axios";
import { eq } from "drizzle-orm";
import { redisConnection, analyzeQueue, createWorkerConnection } from "../queue.js";
import { createDb, sourceMedia } from "@cliphive/db";
import { config } from "../../config.js";
import { withRetry, CircuitBreaker } from "../../utils/retry.js";
import type { TranscriptSegment } from "@cliphive/shared";

interface TranscribeJobData {
  mediaId: string;
  userId: string;
}

interface MLTranscribeResponse {
  transcript: string;
  segments: TranscriptSegment[];
  language: string;
  duration_seconds: number;
}

const db = createDb(config.DATABASE_URL);
const mlBreaker = new CircuitBreaker(5, 120000);

const mlHeaders = () =>
  config.ML_API_KEY
    ? { Authorization: `Bearer ${config.ML_API_KEY}` }
    : {};

export function createTranscribeWorker() {
  const worker = new Worker<TranscribeJobData>(
    "transcribe",
    async (job: Job<TranscribeJobData>) => {
      const { mediaId, userId } = job.data;
      console.info(`[TranscribeWorker] Processing mediaId=${mediaId}`);

      await job.updateProgress(5);

      const [media] = await db
        .select({ id: sourceMedia.id, s3Key: sourceMedia.s3Key })
        .from(sourceMedia)
        .where(eq(sourceMedia.id, mediaId))
        .limit(1);

      if (!media || !media.s3Key) {
        throw new Error(`Media not found or missing s3Key: ${mediaId}`);
      }

      const mediaUrl = `${config.CDN_BASE_URL}/${media.s3Key}`;

      await job.updateProgress(10);

      const response = await withRetry<{ data: MLTranscribeResponse }>(
        () =>
          mlBreaker.execute(() =>
            axios.post<MLTranscribeResponse>(
              `${config.ML_SERVICE_URL}/transcribe`,
              { media_url: mediaUrl, media_id: mediaId },
              { timeout: 600000, headers: mlHeaders() }
            )
          ),
        { attempts: 3, delayMs: 10000, backoff: "exponential" }
      );

      await job.updateProgress(80);

      const { transcript, segments, duration_seconds } = response.data;

      await db
        .update(sourceMedia)
        .set({
          transcript,
          transcriptSegments: segments,
          durationSeconds: duration_seconds,
          processingStatus: "analyzing",
        })
        .where(eq(sourceMedia.id, mediaId));

      await job.updateProgress(90);

      // Queue scene analysis
      await analyzeQueue.add(
        "analyze",
        { mediaId, userId },
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );

      await job.updateProgress(100);
      console.info(`[TranscribeWorker] Completed mediaId=${mediaId}`);

      return { mediaId, transcriptLength: transcript.length, segments: segments.length };
    },
    {
      connection: createWorkerConnection(),
      concurrency: 5,
      limiter: { max: 20, duration: 60000 },
    }
  );

  worker.on("completed", (job) => {
    console.info(`[TranscribeWorker] Job ${job.id} completed`);
  });

  worker.on("failed", async (job, err) => {
    console.error(`[TranscribeWorker] Job ${job?.id} failed:`, err.message);
    if (job?.data.mediaId) {
      await db
        .update(sourceMedia)
        .set({ processingStatus: "error" })
        .where(eq(sourceMedia.id, job.data.mediaId))
        .catch(() => void 0);
    }
  });

  return worker;
}
