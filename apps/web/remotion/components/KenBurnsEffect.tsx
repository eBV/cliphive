import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";

interface Props {
  children: React.ReactNode;
  direction?: "zoom-in" | "zoom-out" | "pan-right" | "pan-left";
}

export function KenBurnsEffect({ children, direction = "zoom-in" }: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const progress = frame / durationInFrames;

  let transform = "";
  switch (direction) {
    case "zoom-in":
      transform = `scale(${interpolate(progress, [0, 1], [1.0, 1.12])})`;
      break;
    case "zoom-out":
      transform = `scale(${interpolate(progress, [0, 1], [1.12, 1.0])})`;
      break;
    case "pan-right":
      transform = `translateX(${interpolate(progress, [0, 1], [-3, 3])}%)`;
      break;
    case "pan-left":
      transform = `translateX(${interpolate(progress, [0, 1], [3, -3])}%)`;
      break;
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        transform,
        transformOrigin: "center",
      }}
    >
      {children}
    </div>
  );
}
