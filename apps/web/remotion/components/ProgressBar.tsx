import { useCurrentFrame, useVideoConfig } from "remotion";

interface Props {
  progress: number;
  color?: string;
}

export function ProgressBar({ progress, color = "#f97316" }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 4,
        background: "rgba(255,255,255,0.15)",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.min(progress * 100, 100)}%`,
          background: color,
          transition: "width 0.1s linear",
        }}
      />
    </div>
  );
}
