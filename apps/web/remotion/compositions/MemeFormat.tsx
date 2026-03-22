import {
  AbsoluteFill,
  Video,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import type { Clip } from "@cliphive/shared";

interface Props {
  clip: Clip;
  src: string;
  topText?: string;
  bottomText?: string;
}

function ImpactText({ text, position }: { text: string; position: "top" | "bottom" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = spring({ frame, fps, config: { damping: 80 } });
  const scale = interpolate(opacity, [0, 1], [0.8, 1]);

  return (
    <div
      style={{
        position: "absolute",
        [position]: 40,
        left: 0,
        right: 0,
        textAlign: "center",
        padding: "0 20px",
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <span
        style={{
          fontFamily: "Impact, Anton, sans-serif",
          fontSize: 72,
          fontWeight: 900,
          color: "#FFFFFF",
          textTransform: "uppercase",
          WebkitTextStroke: "4px black",
          paintOrder: "stroke fill",
          lineHeight: 1.1,
          display: "block",
          wordBreak: "break-word",
        }}
      >
        {text}
      </span>
    </div>
  );
}

export function MemeFormat({ clip, src, topText, bottomText }: Props) {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {src ? (
        <Video
          src={src}
          startFrom={Math.floor(clip.startTime * fps)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <div style={{ width: "100%", height: "100%", background: "#1a1a1a" }} />
      )}

      {topText && <ImpactText text={topText} position="top" />}
      {bottomText && <ImpactText text={bottomText} position="bottom" />}
    </AbsoluteFill>
  );
}
