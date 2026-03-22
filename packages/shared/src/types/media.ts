/** Source media uploaded or imported by the user. */
export interface SourceMedia {
  id: string;
  userId: string;
  title: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  s3Key: string | null;
  durationSeconds: number | null;
  resolution: string | null;
  fileSizeBytes: number | null;
  transcript: string | null;
  transcriptSegments: TranscriptSegment[] | null;
  sceneGraph: SceneGraph | null;
  processingStatus: MediaProcessingStatus;
  createdAt: string;
}

export type SourceType =
  | "upload"
  | "youtube_url"
  | "twitch_vod"
  | "podcast_rss"
  | "screen_recording"
  | "live_stream";

export type MediaProcessingStatus =
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "error";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence: number;
  speaker?: string;
  words?: WordTimestamp[];
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface SceneGraph {
  scenes: Scene[];
  totalScenes: number;
}

export interface Scene {
  sceneId: number;
  startTime: number;
  endTime: number;
  duration: number;
  energyScore: number;
  faceCount: number;
  faceEmotions: Record<string, number>;
  motionMagnitude: number;
  colorVibrancy: number;
  hasText: boolean;
  detectedObjects: string[];
  attentionScore: number;
  isVisualHook: boolean;
}

export interface MediaUploadProgress {
  mediaId: string;
  uploadedBytes: number;
  totalBytes: number;
  percentage: number;
  status: "uploading" | "processing" | "complete" | "error";
}
