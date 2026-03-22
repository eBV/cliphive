"use client";

import { trpc } from "../../lib/trpc";
import { ClipCard } from "./ClipCard";

export function RecentClips() {
  const { data } = trpc.clip.list.useQuery({
    limit: 6,
    sortBy: "createdAt",
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="font-semibold mb-4">Recent Clips</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {data?.clips.map((clip) => (
          <ClipCard key={clip.id} clip={clip} />
        ))}
        {!data?.clips.length && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            No clips yet. Upload media to get started.
          </p>
        )}
      </div>
    </div>
  );
}
