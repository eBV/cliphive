import { Worker, type Job } from "bullmq";
import { redisConnection, createWorkerConnection } from "../queue.js";
import { PublishService } from "../../services/publish.service.js";

interface PublishJobData {
  publicationId: string;
  userId: string;
}

const svc = new PublishService();

export function createPublishWorker() {
  const worker = new Worker<PublishJobData>(
    "publish",
    async (job: Job<PublishJobData>) => {
      const { publicationId, userId } = job.data;
      console.info(`[PublishWorker] Publishing publicationId=${publicationId}`);

      await job.updateProgress(5);
      await svc.publishPublication(publicationId, userId);
      await job.updateProgress(100);

      console.info(`[PublishWorker] Completed publicationId=${publicationId}`);
      return { publicationId };
    },
    {
      connection: createWorkerConnection(),
      concurrency: 5,
      limiter: { max: 30, duration: 60000 },
    }
  );

  worker.on("completed", (job) => {
    console.info(`[PublishWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[PublishWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
