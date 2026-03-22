import type { Server as SocketIOServer } from "socket.io";
import { createIngestWorker } from "./ingest.worker.js";
import { createTranscribeWorker } from "./transcribe.worker.js";
import { createAnalyzeWorker } from "./analyze.worker.js";
import { createDetectClipsWorker } from "./detect-clips.worker.js";
import { createRenderWorker } from "./render.worker.js";
import { createPublishWorker } from "./publish.worker.js";
import { createFetchAnalyticsWorker } from "./fetch-analytics.worker.js";
import { createFetchTrendingWorker } from "./fetch-trending.worker.js";

export function startAllWorkers(_io: SocketIOServer): void {
  const workers = [
    createIngestWorker(),
    createTranscribeWorker(),
    createAnalyzeWorker(),
    createDetectClipsWorker(),
    createRenderWorker(),
    createPublishWorker(),
    createFetchAnalyticsWorker(),
    createFetchTrendingWorker(),
  ];

  console.info(`[Workers] Started ${workers.length} BullMQ workers`);

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.info("[Workers] Shutting down workers…");
    await Promise.all(workers.map((w) => w.close()));
  });
}
