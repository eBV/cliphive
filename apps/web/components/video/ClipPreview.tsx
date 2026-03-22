"use client";

import { Player } from "@remotion/player";
import { TalkingHead } from "../../remotion/compositions/TalkingHead";
import type { Clip } from "@cliphive/shared";

interface Props {
  clip: Clip;
}

export function ClipPreview({ clip }: Props) {
  const fps = 30;
  const durationInFrames = Math.ceil(clip.durationSeconds * fps);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">{clip.title ?? "Clip Preview"}</h2>
      </div>

      <div className="flex justify-center p-4 bg-black/20">
        <div className="rounded-xl overflow-hidden" style={{ width: 270, height: 480 }}>
          <Player
            component={TalkingHead}
            durationInFrames={durationInFrames}
            compositionWidth={1080}
            compositionHeight={1920}
            fps={fps}
            style={{ width: 270, height: 480 }}
            inputProps={{
              clip,
              src: "", // TODO: pass actual CDN URL
            }}
            controls
          />
        </div>
      </div>
    </div>
  );
}
