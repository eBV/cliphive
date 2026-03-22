"use client";

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { PLATFORM_SPECS } from "@cliphive/shared";
import type { Platform } from "@cliphive/shared";
import { Loader2, Send } from "lucide-react";

interface Props {
  clipId: string;
}

const PLATFORM_EMOJIS: Record<Platform, string> = {
  tiktok: "🎵",
  instagram: "📸",
  youtube: "▶️",
  twitter: "🐦",
  facebook: "📘",
  snapchat: "👻",
  linkedin: "💼",
  pinterest: "📌",
};

export function PlatformSelector({ clipId }: Props) {
  const [selected, setSelected] = useState<Set<Platform>>(new Set(["tiktok", "instagram"]));
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  const { data: accounts } = trpc.account.list.useQuery();
  const publishMutation = trpc.publish.create.useMutation();

  function toggle(platform: Platform) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  function handlePublish() {
    publishMutation.mutate({
      clipId,
      platforms: Array.from(selected),
      caption,
      hashtags: hashtags.split(/[\s,]+/).filter(Boolean),
      scheduledAt: scheduledAt || undefined,
    });
  }

  const connectedPlatforms = new Set(accounts?.map((a) => a.platform) ?? []);

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <h3 className="font-semibold">Publish</h3>

      {/* Platform grid */}
      <div className="grid grid-cols-4 gap-2">
        {Object.entries(PLATFORM_SPECS).map(([id, spec]) => {
          const platform = id as Platform;
          const isConnected = connectedPlatforms.has(platform);
          const isSelected = selected.has(platform);
          return (
            <button
              key={platform}
              onClick={() => isConnected && toggle(platform)}
              disabled={!isConnected}
              title={isConnected ? spec.name : `Connect ${spec.name} first`}
              className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors ${
                !isConnected
                  ? "border-border opacity-30 cursor-not-allowed"
                  : isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <span className="text-lg">{PLATFORM_EMOJIS[platform]}</span>
              <span className="capitalize text-[10px]">{platform === "twitter" ? "X" : platform}</span>
            </button>
          );
        })}
      </div>

      {/* Caption */}
      <div>
        <label className="text-xs font-medium text-muted-foreground">Caption</label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write a caption…"
          rows={3}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none"
        />
      </div>

      {/* Hashtags */}
      <div>
        <label className="text-xs font-medium text-muted-foreground">Hashtags</label>
        <input
          type="text"
          value={hashtags}
          onChange={(e) => setHashtags(e.target.value)}
          placeholder="#viral #fyp #contentcreator"
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      {/* Schedule */}
      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Schedule (optional)
        </label>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      <button
        onClick={handlePublish}
        disabled={selected.size === 0 || publishMutation.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {publishMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Publishing…
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            {scheduledAt ? "Schedule" : "Publish Now"} ({selected.size})
          </>
        )}
      </button>

      {publishMutation.isSuccess && (
        <p className="text-xs text-green-400 text-center">
          ✓ {scheduledAt ? "Scheduled!" : "Published!"}
        </p>
      )}
      {publishMutation.isError && (
        <p className="text-xs text-red-400 text-center">
          {publishMutation.error.message}
        </p>
      )}
    </div>
  );
}
