import axios from "axios";
import { eq } from "drizzle-orm";
import { createDb, clips, renderedClips, templates } from "@cliphive/db";
import type { Platform } from "@cliphive/shared";
import { PLATFORM_SPECS } from "@cliphive/shared";
import { config } from "../config.js";
import { StorageService } from "../integrations/storage.js";
import { withRetry, CircuitBreaker } from "../utils/retry.js";
import { getSocketIO } from "../index.js";

interface RenderJobResult {
  renderedClipId: string;
  s3Key: string;
  cdnUrl: string;
  fileSizeBytes: number;
}

interface RemotionRenderResponse {
  renderId: string;
  bucketName: string;
  outputFile: string;
}

interface RemotionProgressResponse {
  done: boolean;
  outputFile?: string;
  outputSizeInBytes?: number;
  errors?: string[];
}

export class RenderService {
  private readonly db: ReturnType<typeof createDb>;
  private readonly storage: StorageService;
  private readonly remotionBreaker: CircuitBreaker;

  constructor() {
    this.db = createDb(config.DATABASE_URL);
    this.storage = new StorageService();
    this.remotionBreaker = new CircuitBreaker(5, 120000);
  }

  async renderClip(
    clipId: string,
    platform: Platform,
    userId: string
  ): Promise<RenderJobResult> {
    const [clip] = await this.db
      .select()
      .from(clips)
      .where(eq(clips.id, clipId))
      .limit(1);

    if (!clip) throw new Error(`Clip not found: ${clipId}`);

    const [template] = clip.templateId
      ? await this.db
          .select()
          .from(templates)
          .where(eq(templates.id, clip.templateId))
          .limit(1)
      : [null];

    const spec = PLATFORM_SPECS[platform];

    // Update status to rendering
    await this.db
      .update(clips)
      .set({ status: "rendering" })
      .where(eq(clips.id, clipId));

    let result: RenderJobResult;

    if (
      config.REMOTION_FUNCTION_NAME &&
      config.REMOTION_S3_BUCKET &&
      config.REMOTION_AWS_ACCESS_KEY_ID
    ) {
      result = await this.renderWithRemotionLambda(
        clip,
        template,
        platform,
        spec,
        userId
      );
    } else {
      result = await this.renderWithFFmpeg(clip, platform, spec, userId);
    }

    // Update clip status to rendered
    await this.db
      .update(clips)
      .set({ status: "rendered" })
      .where(eq(clips.id, clipId));

    // Notify via Socket.IO
    try {
      const io = getSocketIO();
      io.to(`clip:${clipId}`).emit("render:complete", {
        clipId,
        platform,
        renderedClipId: result.renderedClipId,
        cdnUrl: result.cdnUrl,
      });
      io.to(`user:${userId}`).emit("render:complete", {
        clipId,
        platform,
        renderedClipId: result.renderedClipId,
      });
    } catch {
      // Socket not available
    }

    return result;
  }

  private async renderWithRemotionLambda(
    clip: typeof clips.$inferSelect,
    template: typeof templates.$inferSelect | null,
    platform: Platform,
    spec: (typeof PLATFORM_SPECS)[Platform],
    userId: string
  ): Promise<RenderJobResult> {
    const { renderMediaOnLambda, getRenderProgress } = await import(
      "@remotion/lambda/client"
    ).catch(() => {
      throw new Error("@remotion/lambda not installed");
    });

    const inputProps = {
      clipId: clip.id,
      sourceS3Key: clip.sourceMediaId,
      startTime: clip.startTime,
      endTime: clip.endTime,
      platform,
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
      overlayConfig: clip.overlayConfig ?? null,
      templateConfig: template?.config ?? null,
      transcript: clip.transcriptSnippet ?? null,
    };

    const renderResponse = await withRetry<RemotionRenderResponse>(
      () =>
        this.remotionBreaker.execute(() =>
          renderMediaOnLambda({
            region: config.REMOTION_REGION as "us-east-1",
            functionName: config.REMOTION_FUNCTION_NAME!,
            serveUrl: `https://${config.REMOTION_S3_BUCKET}.s3.${config.REMOTION_REGION}.amazonaws.com`,
            composition: template?.remotionCompositionId ?? "ClipHiveDefault",
            inputProps,
            codec: "h264",
            imageFormat: "jpeg",
            maxRetries: 2,
            privacy: "private",
            downloadBehavior: { type: "play-in-browser" },
          })
        ),
      { attempts: 3, delayMs: 5000, backoff: "exponential" }
    );

    // Poll for completion
    let done = false;
    let outputFile: string | undefined;
    let outputSizeInBytes: number | undefined;
    let pollAttempts = 0;
    const maxPollAttempts = 120;

    while (!done && pollAttempts < maxPollAttempts) {
      await new Promise((r) => setTimeout(r, 5000));
      pollAttempts++;

      const progress = await getRenderProgress({
        renderId: renderResponse.renderId,
        bucketName: renderResponse.bucketName,
        functionName: config.REMOTION_FUNCTION_NAME!,
        region: config.REMOTION_REGION as "us-east-1",
      }) as unknown as RemotionProgressResponse;

      if (progress.done) {
        done = true;
        outputFile = progress.outputFile;
        outputSizeInBytes = progress.outputSizeInBytes;
      }

      if (progress.errors && progress.errors.length > 0) {
        throw new Error(`Remotion render failed: ${progress.errors.join(", ")}`);
      }
    }

    if (!done || !outputFile) {
      throw new Error("Remotion render timed out");
    }

    // Copy from Remotion bucket to our media bucket
    const destKey = `rendered/${userId}/${clip.id}/${platform}/${Date.now()}.mp4`;
    await this.storage.copyFromUrl(outputFile, destKey);

    const [inserted] = await this.db
      .insert(renderedClips)
      .values({
        clipId: clip.id,
        platform,
        s3Key: destKey,
        cdnUrl: `${config.CDN_BASE_URL}/${destKey}`,
        fileSizeBytes: outputSizeInBytes ?? null,
        resolution: spec.resolution,
        codec: spec.codec,
        bitrate: spec.bitrate,
      })
      .returning();

    if (!inserted) throw new Error("Failed to insert rendered clip record");

    return {
      renderedClipId: inserted.id,
      s3Key: destKey,
      cdnUrl: `${config.CDN_BASE_URL}/${destKey}`,
      fileSizeBytes: outputSizeInBytes ?? 0,
    };
  }

  private async renderWithFFmpeg(
    clip: typeof clips.$inferSelect,
    platform: Platform,
    spec: (typeof PLATFORM_SPECS)[Platform],
    userId: string
  ): Promise<RenderJobResult> {
    const { FFmpegService } = await import("../utils/ffmpeg.js");
    const ffmpeg = new FFmpegService();

    const sourceKey = clip.sourceMediaId;
    const sourceUrl = `${config.CDN_BASE_URL}/${sourceKey}`;

    const outputPath = `/tmp/render_${clip.id}_${platform}_${Date.now()}.mp4`;

    await ffmpeg.transcodeToSpec({
      inputUrl: sourceUrl,
      outputPath,
      startTime: clip.startTime,
      endTime: clip.endTime,
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
      bitrate: spec.bitrate,
      codec: spec.codec,
    });

    const fs = await import("fs");
    const fileBuffer = fs.readFileSync(outputPath);
    const fileSizeBytes = fileBuffer.length;

    const destKey = `rendered/${userId}/${clip.id}/${platform}/${Date.now()}.mp4`;
    await this.storage.uploadBuffer(destKey, fileBuffer, "video/mp4");

    try {
      fs.unlinkSync(outputPath);
    } catch {
      // Ignore
    }

    const [inserted] = await this.db
      .insert(renderedClips)
      .values({
        clipId: clip.id,
        platform,
        s3Key: destKey,
        cdnUrl: `${config.CDN_BASE_URL}/${destKey}`,
        fileSizeBytes,
        resolution: spec.resolution,
        codec: spec.codec,
        bitrate: spec.bitrate,
      })
      .returning();

    if (!inserted) throw new Error("Failed to insert rendered clip record");

    return {
      renderedClipId: inserted.id,
      s3Key: destKey,
      cdnUrl: `${config.CDN_BASE_URL}/${destKey}`,
      fileSizeBytes,
    };
  }
}
