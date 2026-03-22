import { spring, useCurrentFrame, useVideoConfig } from "remotion";

interface Props {
  text: string;
}

export function CTAOverlay({ text }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = spring({ frame, fps, config: { damping: 80 } });
  const translateY = (1 - opacity) * 20;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 120,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          background: "rgba(249, 115, 22, 0.9)",
          borderRadius: 999,
          padding: "10px 28px",
          backdropFilter: "blur(8px)",
        }}
      >
        <span
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 32,
            fontWeight: 700,
            color: "#fff",
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
}
