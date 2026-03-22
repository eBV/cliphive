/**
 * FFmpeg command builders for ClipHive media processing.
 * All operations use GPU acceleration (NVENC/VAAPI) when available.
 */
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import path from "path";

export interface TranscodeOptions {
  inputPath: string;
  outputPath: string;
  startTime: number;
  endTime: number;
  width: number;
  height: number;
  fps: number;
  bitrate: string;
  codec: string;
  useGpu?: boolean;
}

export interface ThumbnailOptions {
  inputPath: string;
  outputPath: string;
  timestamp: number;
  width?: number;
  height?: number;
}

/**
 * Trim and transcode a clip to a specific platform format.
 */
export async function transcodeClip(opts: TranscodeOptions): Promise<void> {
  const {
    inputPath,
    outputPath,
    startTime,
    endTime,
    width,
    height,
    fps,
    bitrate,
    codec,
    useGpu = false,
  } = opts;

  const duration = endTime - startTime;
  const videoCodec = useGpu ? "h264_nvenc" : "libx264";

  const args = [
    "-ss", String(startTime),
    "-i", inputPath,
    "-t", String(duration),
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    "-c:v", videoCodec,
    "-b:v", bitrate,
    "-r", String(fps),
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-movflags", "+faststart",
    "-preset", useGpu ? "p4" : "fast",
    "-y",
    outputPath,
  ];

  return runFFmpeg(args);
}

/**
 * Extract a thumbnail frame at a specific timestamp.
 */
export async function extractThumbnail(opts: ThumbnailOptions): Promise<void> {
  const { inputPath, outputPath, timestamp, width = 1080, height = 1920 } = opts;

  const args = [
    "-ss", String(timestamp),
    "-i", inputPath,
    "-vframes", "1",
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    "-q:v", "2",
    "-y",
    outputPath,
  ];

  return runFFmpeg(args);
}

/**
 * Burn SRT captions into a video.
 */
export async function burnCaptions(
  inputPath: string,
  srtPath: string,
  outputPath: string
): Promise<void> {
  const args = [
    "-i", inputPath,
    "-vf", `subtitles=${srtPath}:force_style='FontName=Montserrat,FontSize=24,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Bold=1'`,
    "-c:a", "copy",
    "-y",
    outputPath,
  ];

  return runFFmpeg(args);
}

/**
 * Extract audio track from a video file.
 */
export async function extractAudio(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const args = [
    "-i", inputPath,
    "-vn",
    "-c:a", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    "-y",
    outputPath,
  ];

  return runFFmpeg(args);
}

/**
 * Run an FFmpeg command and return a Promise.
 */
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on("error", reject);
  });
}

/**
 * Class wrapper for use in services that prefer OOP style.
 */
export class FFmpegService {
  async transcodeToSpec(opts: {
    inputUrl: string;
    outputPath: string;
    startTime: number;
    endTime: number;
    width: number;
    height: number;
    fps: number;
    bitrate: string;
    codec: string;
  }): Promise<void> {
    return transcodeClip({
      inputPath: opts.inputUrl,
      outputPath: opts.outputPath,
      startTime: opts.startTime,
      endTime: opts.endTime,
      width: opts.width,
      height: opts.height,
      fps: opts.fps,
      bitrate: opts.bitrate,
      codec: opts.codec,
    });
  }

  async extractThumbnail(opts: ThumbnailOptions): Promise<void> {
    return extractThumbnail(opts);
  }

  async burnCaptions(
    inputPath: string,
    srtPath: string,
    outputPath: string
  ): Promise<void> {
    return burnCaptions(inputPath, srtPath, outputPath);
  }

  async extractAudio(inputPath: string, outputPath: string): Promise<void> {
    return extractAudio(inputPath, outputPath);
  }
}
