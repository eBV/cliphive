"use client";

import { useState } from "react";
import { trpc } from "../../../lib/trpc";
import type { Platform } from "@cliphive/shared";

const PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube", "twitter"];

export default function TrendingPage() {
  const [platform, setPlatform] = useState<Platform>("tiktok");

  const { data: sounds } = trpc.trending.getSounds.useQuery({ platform });
  const { data: hashtags } = trpc.trending.getHashtags.useQuery({ platform });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trending</h1>
          <p className="text-muted-foreground">Sounds & hashtags right now</p>
        </div>

        <div className="flex gap-1 rounded-lg border border-border p-1">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                platform === p
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Trending Sounds */}
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">🎵 Trending Sounds</h2>
          </div>
          <ul className="divide-y divide-border">
            {sounds?.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 p-4">
                <span className="w-6 text-center text-sm font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">{s.soundName}</p>
                  <p className="text-xs text-muted-foreground">{s.artist}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {(s.usageCount / 1000).toFixed(0)}K uses
                </span>
              </li>
            ))}
            {!sounds?.length && (
              <li className="p-8 text-center text-sm text-muted-foreground">
                No data yet
              </li>
            )}
          </ul>
        </div>

        {/* Trending Hashtags */}
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold"># Trending Hashtags</h2>
          </div>
          <ul className="divide-y divide-border">
            {hashtags?.map((h, i) => (
              <li key={h.id} className="flex items-center gap-3 p-4">
                <span className="w-6 text-center text-sm font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">#{h.hashtag}</p>
                  <p className="text-xs text-muted-foreground capitalize">{h.category}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium">
                    {(h.volume / 1e6).toFixed(1)}M
                  </p>
                  <p className="text-xs text-green-400">
                    +{(h.velocity * 100).toFixed(0)}%
                  </p>
                </div>
              </li>
            ))}
            {!hashtags?.length && (
              <li className="p-8 text-center text-sm text-muted-foreground">
                No data yet
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
