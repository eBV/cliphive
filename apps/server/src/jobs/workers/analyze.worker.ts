import { Worker, type Job } from "bullmq";
import axios from "axios";
import { eq } from "drizzle-orm";
import { redisConnection, detectClipsQueue, createWorkerConnection } from "../queue.js";
import { createDb, sourceMedia } from "@cliphive/db";
import { config } from "../../config.js";
import { withRetry, CircuitBreaker } from "../../utils/retry.js";
import type { SceneGraph } from "@cliphive/shared";

interface AnalyzeJobData {
  mediaId: string;
  userId: string;
}

interface MLAnalyzeResponse {
  scene_graph: SceneGraph;
  total_scenes: number;
  processing_time_ms: number;
}

const db = createDb(config.DATABASE_URL);
const mlBreaker = new CircuitBreaker(5, 120000);

const mlHeaders = () =>
  config.ML_API_KEY
    ? { Authorization: `Bearer ${config.ML_API_KEY}` }
    : {};

export function createAnalyzeWorker() {
  const worker = new Worker<AnalyzeJobData>(
    "analyze",
    async (job: Job<AnalyzeJobData>) => {
      const { mediaId, userId } = job.data;
      console.info(`[AnalyzeWorker] Processing mediaId=${mediaId}`);

      await job.updateProgress(5);

      const [media] = await db
        .select({
          id: sourceMedia.id,
          s3Key: sourceMedia.s3Key,
          transcript: sourceMedia.transcript,
          transcriptSegments: sourceMedia.transcriptSegments,
        })
        .from(sourceMedia)
        .where(eq(sourceMedia.id, mediaId))
        .limit(1);

      if (!media || !media.s3Key) {
        throw new Error(`Media not found or missing s3Key: ${mediaId}`);
      }

      const mediaUrl = `${config.CDN_BASE_URL}/${media.s3Key}`;

      await job.updateProgress(10);

      const response = await withRetry<{ data: MLAnalyzeResponse }>(
        () =>
          mlBreaker.execute(() =>
            axios.post<MLAnalyzeResponse>(
              `${config.ML_SERVICE_URL}/detect-scenes`,
              {
                media_url: mediaUrl,
                media_id: mediaId,
                transcript: media.transcript ?? null,
                transcript_segments: media.transcriptSegments ?? null,
              },
              { timeout: 600000, headers: mlHeaders() }
            )
          ),
        { attempts: 3, delayMs: 10000, backoff: "exponential" }
      );

      await job.updateProgress(80);

      const { scene_graph } = response.data;

      await db
        .update(sourceMedia)
        .set({
          sceneGraph: scene_graph,
          processingStatus: "ready",
        })
        .where(eq(sourceMedia.id, mediaId));

      await job.updateProgress(90);

      // Queue clip detection
      await detectClipsQueue.add(
        "detect-clips",
        { mediaId, userId },
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );

      await job.updateProgress(100);
      console.info(
        `[AnalyzeWorker] Completed mediaId=${mediaId}, scenes=${scene_graph.totalScenes}`
      );

      return { mediaId, totalScenes: scene_graph.totalScenes };
    },
    {
      connection: createWorkerConnection(),
      concurrency: 5,
      limiter: { max: 20, duration: 60000 },
    }
  );

  worker.on("completed", (job) => {
    console.info(`[AnalyzeWorker] Job ${job.id} completed`);
  });

  worker.on("failed", async (job, err) => {
    console.error(`[AnalyzeWorker] Job ${job?.id} failed:`, err.message);
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
