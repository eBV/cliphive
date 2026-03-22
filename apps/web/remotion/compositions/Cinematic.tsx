import {
  AbsoluteFill,
  Video,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import type { Clip } from "@cliphive/shared";
import { AnimatedCaptions } from "../components/AnimatedCaptions";
import { KenBurnsEffect } from "../components/KenBurnsEffect";

interface Props {
  clip: Clip;
  src: string;
}

const LETTERBOX_HEIGHT_RATIO = 0.12; // ~21:9 letterbox within 9:16

export function Cinematic({ clip, src }: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, height } = useVideoConfig();

  const letterboxH = Math.floor(height * LETTERBOX_HEIGHT_RATIO);

  // Slow dramatic zoom
  const scale = interpolate(frame, [0, durationInFrames], [1.0, 1.08], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* Video layer */}
      <AbsoluteFill
        style={{
          top: letterboxH,
          bottom: letterboxH,
          height: height - letterboxH * 2,
          overflow: "hidden",
        }}
      >
        {src ? (
          <Video
            src={src}
            startFrom={Math.floor(clip.startTime * fps)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${scale})`,
              transformOrigin: "center",
              filter: "contrast(1.1) saturate(0.85)",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
            }}
          />
        )}
        {/* Teal/orange grade overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to bottom, rgba(0,128,128,0.08) 0%, rgba(255,140,0,0.06) 100%)",
            mixBlendMode: "color",
          }}
        />
      </AbsoluteFill>

      {/* Letterbox bars */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: letterboxH, background: "#000" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: letterboxH, background: "#000" }} />

      {/* Captions */}
      {clip.transcriptSnippet && (
        <AnimatedCaptions
          transcript={clip.transcriptSnippet}
          style="minimal"
          startTime={clip.startTime}
          bottomOffset={letterboxH + 24}
        />
      )}
    </AbsoluteFill>
  );
}
