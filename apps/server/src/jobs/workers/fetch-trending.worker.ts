import { Worker, type Job } from "bullmq";
import { redisConnection, createWorkerConnection } from "../queue.js";
import { TrendingService } from "../../services/trending.service.js";
import type { Platform } from "@cliphive/shared";

interface FetchTrendingJobData {
  platforms?: Platform[];
}

const svc = new TrendingService();

export function createFetchTrendingWorker() {
  const worker = new Worker<FetchTrendingJobData>(
    "fetch-trending",
    async (job: Job<FetchTrendingJobData>) => {
      const platforms = job.data.platforms ?? ["tiktok", "instagram", "youtube", "twitter"];
      console.info(`[TrendingWorker] Fetching trending for platforms: ${platforms.join(", ")}`);

      await job.updateProgress(10);
      await svc.fetchAndStoreTrending(platforms);
      await job.updateProgress(100);

      console.info("[TrendingWorker] Completed");
      return { success: true, platforms };
    },
    {
      connection: createWorkerConnection(),
      concurrency: 2,
      limiter: { max: 5, duration: 60000 },
    }
  );

  worker.on("completed", (job) => {
    console.info(`[TrendingWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[TrendingWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
