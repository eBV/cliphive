"use client";

import Link from "next/link";
import { trpc } from "../../../lib/trpc";
import { ProcessingStatusBadge } from "../../../components/shared/ProcessingStatusBadge";
import { formatFileSize, formatDuration } from "@cliphive/shared";
import { Film, Plus, Trash2 } from "lucide-react";

export default function SourcesPage() {
  const { data, isLoading, refetch } = trpc.media.list.useQuery({ limit: 50 });
  const deleteMutation = trpc.media.delete.useMutation({ onSuccess: () => refetch() });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Source Media</h1>
          <p className="text-muted-foreground">{data?.total ?? 0} files</p>
        </div>
        <Link
          href="/upload"
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Add Media
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {data?.media.map((m) => (
            <div key={m.id} className="flex items-center gap-4 p-4 hover:bg-accent/30">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                <Film className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <Link href={`/sources/${m.id}`} className="hover:underline">
                  <p className="font-medium truncate">{m.title ?? "Untitled"}</p>
                </Link>
                <p className="text-xs text-muted-foreground">
                  {m.durationSeconds ? formatDuration(m.durationSeconds) : "—"}
                  {m.fileSizeBytes ? ` · ${formatFileSize(m.fileSizeBytes)}` : ""}
                  {" · "}
                  {m.sourceType.replace("_", " ")}
                </p>
              </div>
              <ProcessingStatusBadge status={m.processingStatus} />
              <button
                onClick={() => deleteMutation.mutate({ id: m.id })}
                className="rounded-md p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {!data?.media.length && (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <Film className="h-10 w-10 opacity-30" />
              <p>No source media yet.</p>
              <Link href="/upload" className="text-sm text-primary hover:underline">
                Upload your first video →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
