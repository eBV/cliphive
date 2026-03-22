"use client";

import { useState } from "react";
import { trpc } from "../../../lib/trpc";
import { ClipCard } from "../../../components/video/ClipCard";
import { ProcessingStatusBadge } from "../../../components/shared/ProcessingStatusBadge";
import type { ClipStatus } from "@cliphive/shared";

type SortKey = "viralityScore" | "createdAt" | "durationSeconds";
type FilterStatus = ClipStatus | "all";

export default function ClipsPage() {
  const [sort, setSort] = useState<SortKey>("viralityScore");
  const [status, setStatus] = useState<FilterStatus>("all");

  const { data, isLoading } = trpc.clip.list.useQuery({
    sortBy: sort,
    status: status === "all" ? undefined : status,
    limit: 50,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clips</h1>
          <p className="text-muted-foreground">
            {data?.total ?? 0} clips detected
          </p>
        </div>

        <div className="flex gap-3">
          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
          >
            <option value="viralityScore">Virality Score</option>
            <option value="createdAt">Newest</option>
            <option value="durationSeconds">Duration</option>
          </select>

          {/* Status filter */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as FilterStatus)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
          >
            <option value="all">All Status</option>
            <option value="detected">Detected</option>
            <option value="queued">Queued</option>
            <option value="rendered">Rendered</option>
            <option value="published">Published</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} />
          ))}
          {data?.clips.length === 0 && (
            <div className="col-span-full py-20 text-center text-muted-foreground">
              No clips found. Upload source media to get started.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
