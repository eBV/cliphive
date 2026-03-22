import { Worker, type Job } from "bullmq";
import { createWorkerConnection } from "../queue.js";
import { ClipDetectionService } from "../../services/clip-detection.service.js";

interface DetectClipsJobData {
  mediaId: string;
  userId: string;
}

const svc = new ClipDetectionService();

export function createDetectClipsWorker() {
  const worker = new Worker<DetectClipsJobData>(
    "detect-clips",
    async (job: Job<DetectClipsJobData>) => {
      const { mediaId, userId } = job.data;
      console.info(`[DetectClipsWorker] Processing mediaId=${mediaId}`);

      await job.updateProgress(10);
      await svc.detectClips(mediaId, userId);
      await job.updateProgress(100);

      console.info(`[DetectClipsWorker] Completed mediaId=${mediaId}`);
      return { mediaId };
    },
    {
      connection: createWorkerConnection(),
      concurrency: 5,
    }
  );

  worker.on("completed", (job) => {
    console.info(`[DetectClipsWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[DetectClipsWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
