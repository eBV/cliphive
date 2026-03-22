import { Suspense } from "react";
import { DashboardStats } from "../../components/analytics/DashboardStats";
import { RecentClips } from "../../components/video/RecentClips";
import { ViralityLeaderboard } from "../../components/analytics/ViralityLeaderboard";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Your virality command center.
        </p>
      </div>

      <Suspense fallback={<StatsLoading />}>
        <DashboardStats />
      </Suspense>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-card" />}>
            <RecentClips />
          </Suspense>
        </div>
        <div>
          <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-card" />}>
            <ViralityLeaderboard />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function StatsLoading() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg bg-card" />
      ))}
    </div>
  );
}
