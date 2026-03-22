/**
 * Object storage operations for AWS S3 / Cloudflare R2.
 * Uses presigned URLs for client-direct uploads.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "fs";
import type { Readable } from "stream";

const s3 = new S3Client({
  endpoint: process.env["S3_ENDPOINT"],
  region: process.env["S3_REGION"] ?? "us-east-1",
  credentials: {
    accessKeyId: process.env["S3_ACCESS_KEY_ID"]!,
    secretAccessKey: process.env["S3_SECRET_ACCESS_KEY"]!,
  },
  forcePathStyle: !!process.env["S3_ENDPOINT"], // required for MinIO
});

const MEDIA_BUCKET = process.env["S3_BUCKET_MEDIA"]!;
const RENDERS_BUCKET = process.env["S3_BUCKET_RENDERS"]!;
const CDN_BASE_URL = process.env["CDN_BASE_URL"] ?? "";

/**
 * Generate a presigned upload URL (PUT) for client-direct upload.
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  bucket = MEDIA_BUCKET,
  expiresIn = 3600
): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(s3, command, { expiresIn });
}

/**
 * Generate a presigned download URL (GET).
 */
export async function getPresignedDownloadUrl(
  key: string,
  bucket = MEDIA_BUCKET,
  expiresIn = 3600
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}

/**
 * Upload a file from a local path.
 */
export async function uploadFile(
  localPath: string,
  key: string,
  contentType: string,
  bucket = MEDIA_BUCKET
): Promise<string> {
  const stream = createReadStream(localPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: stream,
      ContentType: contentType,
    })
  );
  return `${CDN_BASE_URL}/${key}`;
}

/**
 * Upload a Buffer directly.
 */
export async function uploadBuffer(
  buffer: Buffer,
  key: string,
  contentType: string,
  bucket = RENDERS_BUCKET
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return getCdnUrl(key);
}

/**
 * Download an S3 object to a local file.
 */
export async function downloadFile(
  key: string,
  localPath: string,
  bucket = MEDIA_BUCKET
): Promise<void> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = response.Body as Readable;
  return new Promise((resolve, reject) => {
    const writer = createWriteStream(localPath);
    body.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

/**
 * Delete an object from S3.
 */
export async function deleteObject(key: string, bucket = MEDIA_BUCKET): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Check if an object exists.
 */
export async function objectExists(key: string, bucket = MEDIA_BUCKET): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the CDN URL for a renders bucket object.
 */
export function getCdnUrl(key: string): string {
  return `${CDN_BASE_URL}/${key}`;
}

/**
 * Generate a unique S3 key for a media file.
 */
export function generateMediaKey(userId: string, filename: string): string {
  const timestamp = Date.now();
  const ext = filename.split(".").pop() ?? "mp4";
  return `media/${userId}/${timestamp}.${ext}`;
}

/**
 * Generate a unique S3 key for a rendered clip.
 */
export function generateRenderKey(
  clipId: string,
  platform: string,
  ext = "mp4"
): string {
  return `renders/${clipId}/${platform}.${ext}`;
}

// ── Class-based StorageService for use in DI-friendly services ────────

import { config } from "../config.js";
import { withRetry } from "../utils/retry.js";

export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.s3Client = new S3Client({
      region: config.AWS_REGION,
      credentials: {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      },
      ...(config.AWS_S3_ENDPOINT
        ? { endpoint: config.AWS_S3_ENDPOINT, forcePathStyle: true }
        : {}),
    });
    this.bucket = config.AWS_S3_BUCKET;
  }

  async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await withRetry(
      () =>
        this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: buffer,
            ContentType: contentType,
            ContentLength: buffer.length,
          })
        ),
      { attempts: 3, delayMs: 2000, backoff: "exponential" }
    );
  }

  async downloadBuffer(key: string): Promise<Buffer> {
    const response = await withRetry(
      () =>
        this.s3Client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key })
        ),
      { attempts: 3, delayMs: 2000, backoff: "exponential" }
    );

    if (!response.Body) throw new Error(`Empty response for key: ${key}`);
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }

  async getPresignedUploadUrl(key: string, contentType: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.s3Client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn }
    );
  }

  async getPresignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.s3Client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn }
    );
  }

  async deleteObject(key: string): Promise<void> {
    await withRetry(
      () =>
        this.s3Client.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
        ),
      { attempts: 3, delayMs: 1000, backoff: "exponential" }
    );
  }

  async copyFromUrl(sourceUrl: string, destKey: string): Promise<void> {
    const axios = (await import("axios")).default;
    const response = await withRetry<{ data: ArrayBuffer }>(
      () =>
        axios.get<ArrayBuffer>(sourceUrl, {
          responseType: "arraybuffer",
          timeout: 300000,
        }),
      { attempts: 3, delayMs: 3000, backoff: "exponential" }
    );
    const buffer = Buffer.from(response.data);
    await this.uploadBuffer(destKey, buffer, "video/mp4");
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  cdnUrl(key: string): string {
    return `${config.CDN_BASE_URL}/${key}`;
  }
}
