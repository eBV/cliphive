"use client";

import Link from "next/link";
import { trpc } from "../../lib/trpc";
import { Zap, Crown } from "lucide-react";
import { viralityDisplay, truncate } from "../../lib/utils";

export function ViralityLeaderboard() {
  const { data } = trpc.analytics.getTopClips.useQuery({ limit: 10 });

  return (
    <div className="rounded-xl border border-border bg-card h-full">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Crown className="h-4 w-4 text-viral-gold" />
        <h3 className="font-semibold">Top Clips</h3>
      </div>
      <ul className="divide-y divide-border">
        {data?.map((item, i) => {
          const virality = viralityDisplay(item.viralityScore ?? 0);
          return (
            <li key={item.id}>
              <Link href={`/clips/${item.id}`} className="flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors">
                <span className="w-5 text-center text-xs font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium">
                    {truncate(item.title ?? item.transcriptSnippet ?? "Untitled", 40)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.views?.toLocaleString() ?? 0} views
                  </p>
                </div>
                <div className={`flex items-center gap-0.5 text-xs font-bold ${virality.colorClass}`}>
                  <Zap className="h-3 w-3" />
                  {virality.label}
                </div>
              </Link>
            </li>
          );
        })}
        {!data?.length && (
          <li className="p-8 text-center text-sm text-muted-foreground">
            Publish clips to see the leaderboard.
          </li>
        )}
      </ul>
    </div>
  );
}
