"use client";

import { trpc } from "../../../lib/trpc";
import { ProcessingStatusBadge } from "../../../components/shared/ProcessingStatusBadge";
import { formatDistance, parseISO } from "date-fns";
import { Calendar, Send } from "lucide-react";

const PLATFORM_EMOJIS: Record<string, string> = {
  tiktok: "🎵",
  instagram: "📸",
  youtube: "▶️",
  twitter: "🐦",
  facebook: "📘",
  snapchat: "👻",
  linkedin: "💼",
  pinterest: "📌",
};

export default function PublishPage() {
  const { data } = trpc.publish.listPublications.useQuery({ limit: 50 });

  const scheduled = data?.publications.filter((p) => p.status === "scheduled") ?? [];
  const published = data?.publications.filter((p) => p.status === "published") ?? [];
  const failed = data?.publications.filter((p) => p.status === "failed") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Publish Queue</h1>
        <p className="text-muted-foreground">
          {scheduled.length} scheduled · {published.length} published
        </p>
      </div>

      {/* Scheduled */}
      {scheduled.length > 0 && (
        <Section title="📅 Scheduled" items={scheduled} />
      )}

      {/* Published */}
      {published.length > 0 && (
        <Section title="✅ Published" items={published} />
      )}

      {/* Failed */}
      {failed.length > 0 && (
        <Section title="❌ Failed" items={failed} />
      )}

      {!data?.publications.length && (
        <div className="flex flex-col items-center gap-2 py-20 text-muted-foreground">
          <Send className="h-10 w-10 opacity-30" />
          <p>No publications yet.</p>
          <p className="text-sm">Edit a clip and click Publish to get started.</p>
        </div>
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: any[] }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
      </div>
      <ul className="divide-y divide-border">
        {items.map((pub) => (
          <li key={pub.id} className="flex items-center gap-3 p-4">
            <span className="text-2xl">
              {PLATFORM_EMOJIS[pub.socialAccount?.platform ?? ""] ?? "📱"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium">{pub.caption ?? "No caption"}</p>
              <p className="text-xs text-muted-foreground">
                {pub.scheduledAt
                  ? `Scheduled ${formatDistance(parseISO(pub.scheduledAt), new Date(), { addSuffix: true })}`
                  : pub.publishedAt
                  ? `Published ${formatDistance(parseISO(pub.publishedAt), new Date(), { addSuffix: true })}`
                  : "Draft"}
              </p>
            </div>
            <ProcessingStatusBadge status={pub.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
