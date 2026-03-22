"use client";

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { isValidYouTubeUrl } from "@cliphive/shared";
import { Link, Loader2 } from "lucide-react";

const URL_EXAMPLES = [
  "https://youtube.com/watch?v=...",
  "https://youtu.be/...",
  "https://twitch.tv/videos/...",
  "https://podcast-rss-feed.example.com/feed.xml",
];

export function UrlImport() {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  const createMutation = trpc.media.create.useMutation({
    onSuccess: () => {
      setUrl("");
      setTitle("");
      setError("");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a URL.");
      return;
    }

    createMutation.mutate({
      sourceType: detectSourceType(trimmed),
      sourceUrl: trimmed,
      title: title.trim() || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Video / Podcast URL</label>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
          <Link className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={URL_EXAMPLES[0]}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Supports YouTube, Twitch VODs, and podcast RSS feeds.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">
          Title <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="My Podcast Episode #42"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      <button
        type="submit"
        disabled={createMutation.isPending || !url.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {createMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Importing…
          </>
        ) : (
          "Import & Analyze"
        )}
      </button>

      {createMutation.isSuccess && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-400">
          Import started! Your media will appear in Sources once ready.
        </div>
      )}
    </form>
  );
}

function detectSourceType(url: string): "youtube_url" | "twitch_vod" | "podcast_rss" | "upload" {
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube_url";
  if (url.includes("twitch.tv")) return "twitch_vod";
  if (url.includes(".xml") || url.includes("rss") || url.includes("feed")) return "podcast_rss";
  return "upload";
}
