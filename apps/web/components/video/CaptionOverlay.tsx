"use client";

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import type { Clip, CaptionStyle } from "@cliphive/shared";

const CAPTION_STYLES: Array<{ id: CaptionStyle; label: string; preview: string }> = [
  { id: "tiktok_classic", label: "TikTok Classic", preview: "Bold yellow pop" },
  { id: "hormozi", label: "Hormozi", preview: "Red slam impact" },
  { id: "minimal", label: "Minimal", preview: "Clean pill" },
  { id: "karaoke", label: "Karaoke", preview: "Green sweep" },
  { id: "typewriter", label: "Typewriter", preview: "Terminal type" },
];

interface Props {
  clip: Clip;
}

export function CaptionOverlay({ clip }: Props) {
  const [selectedStyle, setSelectedStyle] = useState<CaptionStyle>(
    clip.overlayConfig?.captionStyle ?? "tiktok_classic"
  );
  const [emojiEnabled, setEmojiEnabled] = useState(
    clip.overlayConfig?.emojiReactions ?? false
  );

  const updateMutation = trpc.clip.update.useMutation();

  function save() {
    updateMutation.mutate({
      id: clip.id,
      overlayConfig: {
        ...(clip.overlayConfig ?? {
          template: "",
          zoomKeyframes: [],
          watermark: false,
          progressBar: true,
          emojiReactions: false,
        }),
        captionStyle: selectedStyle,
        emojiReactions: emojiEnabled,
      },
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <h3 className="font-semibold">Captions</h3>

      {/* Style picker */}
      <div className="grid grid-cols-3 gap-2">
        {CAPTION_STYLES.map((style) => (
          <button
            key={style.id}
            onClick={() => setSelectedStyle(style.id)}
            className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
              selectedStyle === style.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40"
            }`}
          >
            <p className="font-medium">{style.label}</p>
            <p className="opacity-70">{style.preview}</p>
          </button>
        ))}
      </div>

      {/* Options */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Auto-emoji</p>
          <p className="text-xs text-muted-foreground">Insert relevant emojis</p>
        </div>
        <button
          onClick={() => setEmojiEnabled(!emojiEnabled)}
          className={`relative h-5 w-9 rounded-full transition-colors ${
            emojiEnabled ? "bg-primary" : "bg-border"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
              emojiEnabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {clip.transcriptSnippet && (
        <div className="rounded-lg bg-accent/50 p-3">
          <p className="text-xs text-muted-foreground mb-1">Transcript snippet</p>
          <p className="text-sm italic">"{clip.transcriptSnippet}"</p>
        </div>
      )}

      <button
        onClick={save}
        disabled={updateMutation.isPending}
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {updateMutation.isPending ? "Saving…" : "Save Caption Settings"}
      </button>
    </div>
  );
}
