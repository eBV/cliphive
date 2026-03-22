import type { Readable } from "stream";
import axios, { type AxiosResponse } from "axios";
import YTDlpWrapModule from "yt-dlp-wrap";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YTDlpWrap = ((YTDlpWrapModule as any).default ?? YTDlpWrapModule) as typeof YTDlpWrapModule;
import { eq } from "drizzle-orm";
import { createDb, sourceMedia } from "@cliphive/db";
import { config } from "../config.js";
import { StorageService } from "../integrations/storage.js";
import { transcribeQueue } from "../jobs/queue.js";
import { withRetry } from "../utils/retry.js";

interface UploadResult {
  s3Key: string;
  cdnUrl: string;
  fileSizeBytes: number;
}

export class MediaIngestionService {
  private readonly storage: StorageService;
  private readonly db: ReturnType<typeof createDb>;
  private readonly ytDlp: YTDlpWrap;

  constructor() {
    this.storage = new StorageService();
    this.db = createDb(config.DATABASE_URL);
    this.ytDlp = new YTDlpWrap();
  }

  /**
   * Upload a file stream (from multipart request) directly to S3.
   */
  async uploadFileStream(
    mediaId: string,
    stream: Readable,
    filename: string,
    contentType: string
  ): Promise<UploadResult> {
    const s3Key = `media/${mediaId}/original/${filename}`;

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const buffer = Buffer.concat(chunks);

    await this.storage.uploadBuffer(s3Key, buffer, contentType);

    await this.db
      .update(sourceMedia)
      .set({
        s3Key,
        fileSizeBytes: buffer.length,
        processingStatus: "transcribing",
      })
      .where(eq(sourceMedia.id, mediaId));

    const cdnUrl = `${config.CDN_BASE_URL}/${s3Key}`;

    return { s3Key, cdnUrl, fileSizeBytes: buffer.length };
  }

  /**
   * Download from YouTube / Twitch VOD using yt-dlp and upload to S3.
   */
  async downloadFromUrl(
    mediaId: string,
    userId: string,
    sourceUrl: string,
    sourceType: string
  ): Promise<UploadResult> {
    console.info(`[MediaIngestion] Downloading ${sourceType} from ${sourceUrl}`);

    const tmpPath = `/tmp/${mediaId}.mp4`;

    await withRetry(
      async () => {
        await this.ytDlp.execPromise([
          sourceUrl,
          "--format",
          "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
          "--merge-output-format",
          "mp4",
          "--output",
          tmpPath,
          "--no-playlist",
          "--max-filesize",
          "5G",
        ]);
      },
      { attempts: 3, delayMs: 5000, backoff: "exponential" }
    );

    const fs = await import("fs");
    const fileBuffer = fs.readFileSync(tmpPath);
    const fileSizeBytes = fileBuffer.length;

    const s3Key = `media/${userId}/${mediaId}/original/video.mp4`;
    await this.storage.uploadBuffer(s3Key, fileBuffer, "video/mp4");

    // Cleanup temp file
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore
    }

    await this.db
      .update(sourceMedia)
      .set({
        s3Key,
        fileSizeBytes,
        processingStatus: "transcribing",
      })
      .where(eq(sourceMedia.id, mediaId));

    const cdnUrl = `${config.CDN_BASE_URL}/${s3Key}`;
    return { s3Key, cdnUrl, fileSizeBytes };
  }

  /**
   * Fetch a podcast episode from RSS and download the audio.
   */
  async downloadFromRss(
    mediaId: string,
    userId: string,
    rssUrl: string
  ): Promise<UploadResult> {
    const { XMLParser } = await import("fast-xml-parser").catch(() => {
      throw new Error("fast-xml-parser not installed");
    });

    const response = await withRetry(
      () => axios.get<string>(rssUrl, { responseType: "text", timeout: 30000 }),
      { attempts: 3, delayMs: 2000, backoff: "exponential" }
    );

    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(response.data) as {
      rss?: { channel?: { item?: Array<{ enclosure?: { "@_url"?: string } }> } };
    };

    const enclosureUrl =
      parsed.rss?.channel?.item?.[0]?.enclosure?.["@_url"];

    if (!enclosureUrl) {
      throw new Error("No enclosure URL found in RSS feed");
    }

    const audioResp = await withRetry(
      () =>
        axios.get<ArrayBuffer>(enclosureUrl, {
          responseType: "arraybuffer",
          timeout: 300000,
        }),
      { attempts: 3, delayMs: 3000, backoff: "exponential" }
    );

    const buffer = Buffer.from(audioResp.data);
    const s3Key = `media/${userId}/${mediaId}/original/audio.mp3`;
    await this.storage.uploadBuffer(s3Key, buffer, "audio/mpeg");

    await this.db
      .update(sourceMedia)
      .set({
        s3Key,
        fileSizeBytes: buffer.length,
        processingStatus: "transcribing",
      })
      .where(eq(sourceMedia.id, mediaId));

    const cdnUrl = `${config.CDN_BASE_URL}/${s3Key}`;
    return { s3Key, cdnUrl, fileSizeBytes: buffer.length };
  }

  /**
   * Trigger the full processing pipeline: transcribe → analyze → detect clips.
   */
  async triggerProcessingPipeline(
    mediaId: string,
    userId: string
  ): Promise<void> {
    // Queue transcription first; each worker chains to the next
    await transcribeQueue.add(
      "transcribe",
      { mediaId, userId },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        priority: 5,
      }
    );

    console.info(`[MediaIngestion] Pipeline queued for mediaId=${mediaId}`);
  }

  /**
   * Call the ML service to probe media metadata.
   */
  async probeMediaMetadata(mediaId: string, s3Key: string): Promise<void> {
    const mediaUrl = `${config.CDN_BASE_URL}/${s3Key}`;

    const response = await withRetry<AxiosResponse<{
      duration_seconds: number;
      resolution: string;
    }>>(
      () =>
        axios.post(
          `${config.ML_SERVICE_URL}/probe`,
          { media_url: mediaUrl },
          {
            timeout: 60000,
            headers: config.ML_API_KEY
              ? { Authorization: `Bearer ${config.ML_API_KEY}` }
              : {},
          }
        ),
      { attempts: 3, delayMs: 2000, backoff: "exponential" }
    );

    await this.db
      .update(sourceMedia)
      .set({
        durationSeconds: response.data.duration_seconds,
        resolution: response.data.resolution,
      })
      .where(eq(sourceMedia.id, mediaId));
  }
}
