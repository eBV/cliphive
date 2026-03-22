import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import type { CaptionStyle } from "@cliphive/shared";

interface Props {
  transcript: string;
  style: CaptionStyle;
  startTime: number;
  bottomOffset?: number;
}

const STYLE_CONFIG: Record<CaptionStyle, {
  fontFamily: string;
  fontSize: number;
  color: string;
  highlightColor: string;
  maxWords: number;
  strokeWidth: string;
}> = {
  tiktok_classic: {
    fontFamily: "Montserrat, sans-serif",
    fontSize: 52,
    color: "#FFFFFF",
    highlightColor: "#FFD700",
    maxWords: 4,
    strokeWidth: "3px black",
  },
  hormozi: {
    fontFamily: "Anton, Impact, sans-serif",
    fontSize: 72,
    color: "#FFFFFF",
    highlightColor: "#FF0000",
    maxWords: 3,
    strokeWidth: "4px black",
  },
  minimal: {
    fontFamily: "Inter, sans-serif",
    fontSize: 36,
    color: "#FFFFFF",
    highlightColor: "#FFFFFF",
    maxWords: 8,
    strokeWidth: "none",
  },
  karaoke: {
    fontFamily: "Poppins, sans-serif",
    fontSize: 52,
    color: "rgba(255,255,255,0.5)",
    highlightColor: "#00FF88",
    maxWords: 6,
    strokeWidth: "2px rgba(0,0,0,0.5)",
  },
  typewriter: {
    fontFamily: "'Space Mono', monospace",
    fontSize: 40,
    color: "#00FF00",
    highlightColor: "#00FF00",
    maxWords: 6,
    strokeWidth: "none",
  },
};

export function AnimatedCaptions({ transcript, style, startTime, bottomOffset = 100 }: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const config = STYLE_CONFIG[style];

  const words = transcript.split(/\s+/).filter(Boolean);
  const wordsPerScreen = config.maxWords;

  // Estimate current word based on frame
  const wordsPerSecond = 2.5; // Average speech rate
  const currentWordIndex = Math.floor((frame / fps) * wordsPerSecond);
  const screenIndex = Math.floor(currentWordIndex / wordsPerScreen);
  const visibleWords = words.slice(
    screenIndex * wordsPerScreen,
    (screenIndex + 1) * wordsPerScreen
  );

  const screenFrame = frame % Math.ceil((wordsPerScreen / wordsPerSecond) * fps);
  const wordInScreen = Math.floor((screenFrame / fps) * wordsPerSecond);

  if (!visibleWords.length) return null;

  const isMinimal = style === "minimal";
  const isTypewriter = style === "typewriter";

  return (
    <div
      style={{
        position: "absolute",
        bottom: bottomOffset,
        left: 0,
        right: 0,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: 8,
        padding: "0 32px",
      }}
    >
      {isMinimal ? (
        <div
          style={{
            background: "rgba(0,0,0,0.6)",
            borderRadius: 999,
            padding: "8px 20px",
            textAlign: "center",
          }}
        >
          <span
            style={{
              fontFamily: config.fontFamily,
              fontSize: config.fontSize,
              color: config.color,
              fontWeight: 500,
            }}
          >
            {visibleWords.join(" ")}
          </span>
        </div>
      ) : (
        visibleWords.map((word, i) => {
          const isCurrentWord = i === wordInScreen;
          const opacity = i <= wordInScreen ? 1 : 0.3;

          return (
            <span
              key={`${screenIndex}-${i}`}
              style={{
                fontFamily: config.fontFamily,
                fontSize: config.fontSize,
                fontWeight: 900,
                color: isCurrentWord && style !== "karaoke" ? config.highlightColor : config.color,
                WebkitTextStroke: config.strokeWidth !== "none" ? config.strokeWidth : undefined,
                paintOrder: "stroke fill",
                opacity,
                transform: isCurrentWord ? "scale(1.08)" : "scale(1)",
                transition: "transform 0.1s, color 0.1s",
                display: "inline-block",
                textShadow: "2px 2px 8px rgba(0,0,0,0.8)",
              }}
            >
              {word}
            </span>
          );
        })
      )}
    </div>
  );
}
