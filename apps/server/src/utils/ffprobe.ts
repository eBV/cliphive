/**
 * Media probe utilities using FFprobe.
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface MediaInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  audioChannels: number;
  audioSampleRate: number;
  format: string;
  fileSizeBytes: number;
}

/**
 * Probe a media file and return its metadata.
 */
export async function probeMedia(filePath: string): Promise<MediaInfo> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const data = JSON.parse(stdout) as FFprobeOutput;

  const videoStream = data.streams.find((s) => s.codec_type === "video");
  const audioStream = data.streams.find((s) => s.codec_type === "audio");

  if (!videoStream) {
    throw new Error("No video stream found in media file");
  }

  const [fpsNum, fpsDen] = (videoStream.r_frame_rate ?? "30/1").split("/").map(Number);
  const fps = fpsDen ? fpsNum / fpsDen : 30;

  return {
    duration: parseFloat(data.format.duration ?? "0"),
    width: videoStream.width ?? 0,
    height: videoStream.height ?? 0,
    fps,
    codec: videoStream.codec_name ?? "unknown",
    bitrate: parseInt(data.format.bit_rate ?? "0"),
    audioChannels: audioStream?.channels ?? 0,
    audioSampleRate: parseInt(audioStream?.sample_rate ?? "0"),
    format: data.format.format_name ?? "unknown",
    fileSizeBytes: parseInt(data.format.size ?? "0"),
  };
}

interface FFprobeOutput {
  streams: Array<{
    codec_type: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    channels?: number;
    sample_rate?: string;
  }>;
  format: {
    duration?: string;
    bit_rate?: string;
    format_name?: string;
    size?: string;
  };
}
