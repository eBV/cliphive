import { Worker, type Job } from "bullmq";
import { redisConnection, createWorkerConnection } from "../queue.js";
import { RenderService } from "../../services/render.service.js";
import type { Platform } from "@cliphive/shared";

interface RenderJobData {
  clipId: string;
  platform: Platform;
  userId: string;
}

const svc = new RenderService();

export function createRenderWorker() {
  const worker = new Worker<RenderJobData>(
    "render",
    async (job: Job<RenderJobData>) => {
      const { clipId, platform, userId } = job.data;
      console.info(`[RenderWorker] Rendering clipId=${clipId} for ${platform}`);

      await job.updateProgress(5);

      const result = await svc.renderClip(clipId, platform, userId);

      await job.updateProgress(100);
      console.info(
        `[RenderWorker] Completed clipId=${clipId} platform=${platform} renderedClipId=${result.renderedClipId}`
      );

      return result;
    },
    {
      connection: createWorkerConnection(),
      concurrency: 5,
      limiter: { max: 20, duration: 60000 },
    }
  );

  worker.on("completed", (job) => {
    console.info(`[RenderWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[RenderWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
