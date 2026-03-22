/** Represents a detected or manually created clip. */
export interface Clip {
  id: string;
  userId: string;
  sourceMediaId: string;
  title: string;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  viralityScore: number | null;
  hookScore: number | null;
  energyScore: number | null;
  emotionTags: EmotionTag[];
  transcriptSnippet: string | null;
  templateId: string | null;
  overlayConfig: OverlayConfig | null;
  status: ClipStatus;
  createdAt: string;
}

export type ClipStatus =
  | "detected"
  | "queued"
  | "rendering"
  | "rendered"
  | "published"
  | "failed";

export type EmotionTag =
  | "surprise"
  | "humor"
  | "awe"
  | "controversy"
  | "joy"
  | "anger"
  | "fear"
  | "sadness"
  | "disgust"
  | "anticipation"
  | "trust";

export interface OverlayConfig {
  captionStyle: CaptionStyle;
  template: string;
  zoomKeyframes: ZoomKeyframe[];
  watermark: boolean;
  ctaText?: string;
  emojiReactions: boolean;
  progressBar: boolean;
  backgroundMusic?: BackgroundMusicConfig;
}

export interface ZoomKeyframe {
  time: number;
  scale: number;
  x: number;
  y: number;
}

export interface BackgroundMusicConfig {
  soundId: string;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export type CaptionStyle =
  | "tiktok_classic"
  | "hormozi"
  | "minimal"
  | "karaoke"
  | "typewriter";

export interface ClipCandidate {
  startTime: number;
  endTime: number;
  durationSeconds: number;
  viralityScore: number;
  hookScore: number;
  energyScore: number;
  emotionTags: EmotionTag[];
  transcriptSnippet: string;
  featureVector: number[];
}

export interface RenderedClip {
  id: string;
  clipId: string;
  platform: string;
  s3Key: string;
  cdnUrl: string | null;
  fileSizeBytes: number | null;
  resolution: string | null;
  codec: string | null;
  bitrate: string | null;
  thumbnailUrl: string | null;
  renderedAt: string;
}
