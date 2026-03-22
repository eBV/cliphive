import { Composition } from "remotion";
import { TalkingHead } from "./compositions/TalkingHead";
import { Cinematic } from "./compositions/Cinematic";
import { MemeFormat } from "./compositions/MemeFormat";

const DEFAULT_FPS = 30;
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;

export function Root() {
  return (
    <>
      <Composition
        id="TalkingHead"
        component={TalkingHead}
        durationInFrames={300}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        defaultProps={{
          clip: {
            id: "preview",
            userId: "",
            sourceMediaId: "",
            title: "Preview",
            startTime: 0,
            endTime: 10,
            durationSeconds: 10,
            viralityScore: 0.85,
            hookScore: 0.9,
            energyScore: 0.8,
            emotionTags: ["humor"],
            transcriptSnippet: "This is an example caption for preview.",
            templateId: null,
            overlayConfig: null,
            status: "detected",
            createdAt: new Date().toISOString(),
          },
          src: "",
        }}
      />

      <Composition
        id="Cinematic"
        component={Cinematic}
        durationInFrames={300}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        defaultProps={{ clip: {} as any, src: "" }}
      />

      <Composition
        id="MemeFormat"
        component={MemeFormat}
        durationInFrames={300}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        defaultProps={{
          clip: {} as any,
          src: "",
          topText: "WHEN YOU FINALLY",
          bottomText: "SHIP THE FEATURE",
        }}
      />
    </>
  );
}
