import {
  AbsoluteFill,
  Video,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
} from "remotion";
import type { Clip } from "@cliphive/shared";
import { AnimatedCaptions } from "../components/AnimatedCaptions";
import { ProgressBar } from "../components/ProgressBar";
import { CTAOverlay } from "../components/CTAOverlay";
import { KenBurnsEffect } from "../components/KenBurnsEffect";

interface Props {
  clip: Clip;
  src: string;
  faceTrack?: Array<{ time: number; x: number; y: number; width: number; height: number }>;
}

export function TalkingHead({ clip, src, faceTrack = [] }: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const currentTime = frame / fps;

  // Face tracking: find current face position
  const currentFace = faceTrack.find((f, i) => {
    const next = faceTrack[i + 1];
    return f.time <= currentTime && (!next || next.time > currentTime);
  }) ?? { x: width / 2, y: height * 0.35, width: 600, height: 600 };

  // Zoom: gentle auto-zoom on face
  const zoom = interpolate(
    frame,
    [0, 10, durationInFrames - 10, durationInFrames],
    [1.0, 1.05, 1.05, 1.0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Face-centered crop offset
  const targetX = currentFace.x - width / 2;
  const targetY = currentFace.y - height * 0.35;
  const smoothX = interpolate(frame, [0, fps * 0.5], [0, targetX], {
    extrapolateRight: "clamp",
  });
  const smoothY = interpolate(frame, [0, fps * 0.5], [0, targetY], {
    extrapolateRight: "clamp",
  });

  const showCTA = clip.overlayConfig?.ctaText && frame > durationInFrames - fps * 3;

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* Video layer with face-tracked zoom */}
      {src ? (
        <Video
          src={src}
          startFrom={Math.floor(clip.startTime * fps)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${zoom}) translate(${-smoothX / zoom}px, ${-smoothY / zoom}px)`,
            transformOrigin: "center",
          }}
        />
      ) : (
        // Placeholder when no src (preview mode)
        <AbsoluteFill style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,0.2)",
              fontSize: 48,
            }}
          >
            ▶
          </div>
        </AbsoluteFill>
      )}

      {/* Background blur vignette on edges */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.5) 100%)",
        }}
      />

      {/* Captions */}
      {clip.transcriptSnippet && (
        <AnimatedCaptions
          transcript={clip.transcriptSnippet}
          style={clip.overlayConfig?.captionStyle ?? "tiktok_classic"}
          startTime={clip.startTime}
        />
      )}

      {/* Progress bar */}
      {clip.overlayConfig?.progressBar && (
        <ProgressBar progress={frame / durationInFrames} />
      )}

      {/* CTA overlay */}
      {showCTA && clip.overlayConfig?.ctaText && (
        <CTAOverlay text={clip.overlayConfig.ctaText} />
      )}
    </AbsoluteFill>
  );
}
