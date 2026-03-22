import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { config } from "./config.js";
import { createContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";
import { startAllWorkers } from "./jobs/workers/index.js";
import { startScheduler } from "./jobs/scheduler.js";

async function bootstrap() {
  console.info("[Bootstrap] Starting...");
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "warn" : "info",
      transport:
        config.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
    trustProxy: true,
    maxParamLength: 5000,
  });

  // ── HTTP server for Socket.IO co-hosting ─────────────────────────────
  const httpServer = createServer(app.server);

  // ── Socket.IO ────────────────────────────────────────────────────────
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.CORS_ORIGINS.split(",").map((o) => o.trim()),
      credentials: true,
    },
    path: "/ws",
    transports: ["websocket", "polling"],
  });

  // Attach io to fastify instance for access in routes
  app.decorate("io", io);

  io.on("connection", (socket) => {
    app.log.info(`Socket connected: ${socket.id}`);

    socket.on("subscribe:media", (mediaId: string) => {
      void socket.join(`media:${mediaId}`);
    });

    socket.on("subscribe:clip", (clipId: string) => {
      void socket.join(`clip:${clipId}`);
    });

    socket.on("subscribe:user", (userId: string) => {
      void socket.join(`user:${userId}`);
    });

    socket.on("disconnect", () => {
      app.log.info(`Socket disconnected: ${socket.id}`);
    });
  });

  // Export io for use in workers / services
  export_io(io);

  // ── Plugins ──────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(",").map((o) => o.trim()),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (req) =>
      (req.headers["x-user-id"] as string) ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      code: "TOO_MANY_REQUESTS",
      error: "Rate limit exceeded",
      message: `Too many requests, please try again after ${Math.ceil(
        context.ttl / 1000
      )} seconds`,
    }),
  });

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024 * 1024, // 5 GB
      files: 1,
    },
  });

  // ── tRPC ─────────────────────────────────────────────────────────────
  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      onError: ({ path, error }) => {
        app.log.error(`tRPC error on ${path}: ${error.message}`);
      },
    },
  });

  // ── Direct file upload endpoint (multipart to S3) ────────────────────
  app.post(
    "/api/upload/:mediaId",
    {
      config: { rateLimit: { max: 20, timeWindow: 60000 } },
    },
    async (request, reply) => {
      const { mediaId } = request.params as { mediaId: string };
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No file provided" });
      }

      const { MediaIngestionService } = await import(
        "./services/media-ingestion.service.js"
      );
      const svc = new MediaIngestionService();
      try {
        const result = await svc.uploadFileStream(
          mediaId,
          data.file,
          data.filename,
          data.mimetype
        );
        return reply.status(200).send(result);
      } catch (err) {
        app.log.error(err);
        return reply.status(500).send({ error: "Upload failed" });
      }
    }
  );

  // ── Health check ─────────────────────────────────────────────────────
  app.get("/health", async (_req, reply) => {
    return reply.send({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: process.env["npm_package_version"] ?? "0.0.1",
    });
  });

  // ── BullMQ Workers ───────────────────────────────────────────────────
  console.info("[Bootstrap] Starting workers...");
  startAllWorkers(io);

  // ── Cron scheduler ───────────────────────────────────────────────────
  console.info("[Bootstrap] Starting scheduler...");
  startScheduler();

  // ── Graceful shutdown ────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    app.log.warn(`Received ${signal}. Shutting down gracefully…`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error("Error during shutdown", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // ── Listen ───────────────────────────────────────────────────────────
  console.info(`[Bootstrap] Attempting to listen on ${config.HOST}:${config.PORT}...`);
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(
    `ClipHive server listening on http://${config.HOST}:${config.PORT}`
  );
}

// Singleton Socket.IO export pattern
let _io: SocketIOServer | null = null;
function export_io(io: SocketIOServer) {
  _io = io;
}
export function getSocketIO(): SocketIOServer {
  if (!_io) throw new Error("Socket.IO not initialized");
  return _io;
}

bootstrap().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
