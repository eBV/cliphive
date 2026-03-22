"use client";

import { useState } from "react";
import { trpc } from "../../../lib/trpc";
import { ViewsChart } from "../../../components/analytics/ViewsChart";
import { EngagementHeatmap } from "../../../components/analytics/EngagementHeatmap";
import { ViralityLeaderboard } from "../../../components/analytics/ViralityLeaderboard";
import type { Platform } from "@cliphive/shared";

const PLATFORMS: Array<{ id: Platform | "all"; label: string }> = [
  { id: "all", label: "All Platforms" },
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
  { id: "twitter", label: "X / Twitter" },
  { id: "facebook", label: "Facebook" },
  { id: "linkedin", label: "LinkedIn" },
];

export default function AnalyticsPage() {
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [days, setDays] = useState(30);

  const { data, isLoading } = trpc.analytics.getAggregated.useQuery({
    platform: platform === "all" ? undefined : platform,
    days,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">Cross-platform performance</p>
        </div>

        <div className="flex gap-3">
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform | "all")}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
          >
            {PLATFORMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      {/* KPI row */}
      {data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard label="Total Views" value={data.totalViews.toLocaleString()} />
          <KpiCard label="Total Reach" value={data.totalReach.toLocaleString()} />
          <KpiCard
            label="Avg Engagement"
            value={`${(data.avgEngagementRate * 100).toFixed(2)}%`}
          />
          <KpiCard
            label="Avg Watch %"
            value={`${(data.avgWatchPercentage * 100).toFixed(1)}%`}
          />
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <ViewsChart data={data?.timeSeries ?? []} isLoading={isLoading} />
        </div>
        <div>
          <ViralityLeaderboard />
        </div>
      </div>

      <EngagementHeatmap platformData={data?.platformBreakdown ?? []} />
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
