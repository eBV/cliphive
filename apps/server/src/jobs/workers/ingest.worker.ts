import { Worker, type Job } from "bullmq";
import { redisConnection, transcribeQueue, createWorkerConnection } from "../queue.js";
import { MediaIngestionService } from "../../services/media-ingestion.service.js";
import { createDb, sourceMedia } from "@cliphive/db";
import { eq } from "drizzle-orm";
import { config } from "../../config.js";

interface IngestJobData {
  mediaId: string;
  userId: string;
  sourceUrl?: string;
  sourceType?: string;
}

const svc = new MediaIngestionService();
const db = createDb(config.DATABASE_URL);

export function createIngestWorker() {
  const worker = new Worker<IngestJobData>(
    "ingest",
    async (job: Job<IngestJobData>) => {
      const { mediaId, userId, sourceUrl, sourceType } = job.data;
      console.info(`[IngestWorker] Processing mediaId=${mediaId} type=${sourceType}`);

      await job.updateProgress(5);

      try {
        if (!sourceUrl) {
          throw new Error("No source URL provided for URL-based ingestion");
        }

        let result: { s3Key: string; cdnUrl: string; fileSizeBytes: number };

        if (sourceType === "podcast_rss") {
          result = await svc.downloadFromRss(mediaId, userId, sourceUrl);
        } else {
          result = await svc.downloadFromUrl(mediaId, userId, sourceUrl, sourceType ?? "youtube_url");
        }

        await job.updateProgress(70);

        // Probe metadata
        await svc.probeMediaMetadata(mediaId, result.s3Key);

        await job.updateProgress(85);

        // Update DB status
        await db
          .update(sourceMedia)
          .set({ processingStatus: "transcribing" })
          .where(eq(sourceMedia.id, mediaId));

        // Queue transcription
        await transcribeQueue.add(
          "transcribe",
          { mediaId, userId },
          {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          }
        );

        await job.updateProgress(100);
        console.info(`[IngestWorker] Completed mediaId=${mediaId}`);

        return { mediaId, s3Key: result.s3Key, fileSizeBytes: result.fileSizeBytes };
      } catch (err) {
        await db
          .update(sourceMedia)
          .set({ processingStatus: "error" })
          .where(eq(sourceMedia.id, mediaId));
        throw err;
      }
    },
    {
      connection: createWorkerConnection(),
      concurrency: 3,
      limiter: { max: 10, duration: 60000 },
    }
  );

  worker.on("completed", (job) => {
    console.info(`[IngestWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[IngestWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
