import cron from "node-cron";
import { analyticsQueue, trendingQueue, retrainQueue } from "./queue.js";
import { ViralityOptimizerService } from "../services/virality-optimizer.service.js";

export function startScheduler(): void {
  console.info("[Scheduler] Starting cron jobs…");

  // ── Analytics: every 2 hours ──────────────────────────────────────
  cron.schedule("0 */2 * * *", async () => {
    console.info("[Scheduler] Triggering analytics fetch");
    await analyticsQueue.add(
      "fetch-analytics",
      { fetchAll: true },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: 10,
        removeOnFail: 20,
      }
    );
  });

  // ── Trending: every 6 hours ───────────────────────────────────────
  cron.schedule("0 */6 * * *", async () => {
    console.info("[Scheduler] Triggering trending data refresh");
    await trendingQueue.add(
      "fetch-trending",
      { platforms: ["tiktok", "instagram", "youtube", "twitter"] },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 5,
        removeOnFail: 10,
      }
    );
  });

  // ── Virality model retrain: weekly on Sundays at 02:00 UTC ────────
  cron.schedule("0 2 * * 0", async () => {
    console.info("[Scheduler] Triggering weekly model retrain");
    await retrainQueue.add(
      "retrain",
      { trigger: "scheduled" },
      {
        attempts: 2,
        backoff: { type: "exponential", delay: 30000 },
        removeOnComplete: 3,
        removeOnFail: 5,
      }
    );
  });

  // ── Immediate startup: fetch trending data on cold start ──────────
  void trendingQueue.add(
    "fetch-trending",
    { platforms: ["tiktok", "instagram", "youtube"] },
    {
      delay: 30000, // 30s after startup
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1,
    }
  );

  console.info("[Scheduler] Cron jobs registered: analytics(2h), trending(6h), retrain(weekly)");
}

// Retrain worker inline (since it's a simple wrapper)
import { Worker, type Job } from "bullmq";
import { redisConnection } from "./queue.js";

interface RetrainJobData {
  trigger: "scheduled" | "manual";
}

export function createRetrainWorker() {
  const svc = new ViralityOptimizerService();

  const worker = new Worker<RetrainJobData>(
    "retrain",
    async (job: Job<RetrainJobData>) => {
      console.info(`[RetrainWorker] Starting retrain (trigger=${job.data.trigger})`);
      await job.updateProgress(10);
      const status = await svc.runRetrainCycle(job.data.trigger);
      await job.updateProgress(100);
      return status;
    },
    {
      connection: redisConnection,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    console.info(`[RetrainWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[RetrainWorker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
