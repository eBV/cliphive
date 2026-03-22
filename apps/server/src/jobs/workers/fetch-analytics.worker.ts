import { Worker, type Job } from "bullmq";
import { redisConnection, createWorkerConnection } from "../queue.js";
import { AnalyticsFetcherService } from "../../services/analytics-fetcher.service.js";

interface FetchAnalyticsJobData {
  publicationId?: string;
  userId?: string;
  fetchAll?: boolean;
}

const svc = new AnalyticsFetcherService();

export function createFetchAnalyticsWorker() {
  const worker = new Worker<FetchAnalyticsJobData>(
    "fetch-analytics",
    async (job: Job<FetchAnalyticsJobData>) => {
      const { publicationId, userId, fetchAll } = job.data;

      await job.updateProgress(5);

      if (fetchAll && userId) {
        console.info(`[AnalyticsWorker] Fetching all analytics for userId=${userId}`);
        await svc.fetchAllPublished(userId);
      } else if (publicationId) {
        console.info(`[AnalyticsWorker] Fetching for publicationId=${publicationId}`);
        await svc.fetchForPublication(publicationId);
      } else {
        console.warn("[AnalyticsWorker] No publicationId or userId provided");
      }

      await job.updateProgress(100);
      return { success: true };
    },
    {
      connection: createWorkerConnection(),
      concurrency: 10,
      limiter: { max: 50, duration: 60000 },
    }
  );

  worker.on("completed", (job) => {
    console.info(`[AnalyticsWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[AnalyticsWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
