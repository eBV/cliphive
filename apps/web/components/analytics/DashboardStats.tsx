"use client";

import { trpc } from "../../lib/trpc";
import { Eye, TrendingUp, Film, Send } from "lucide-react";
import { motion } from "framer-motion";

export function DashboardStats() {
  const { data } = trpc.analytics.getAggregated.useQuery({ days: 30 });
  const { data: clipsData } = trpc.clip.list.useQuery({ limit: 1 });

  const stats = [
    {
      label: "Total Views (30d)",
      value: data?.totalViews.toLocaleString() ?? "—",
      icon: Eye,
      trend: "+12%",
      positive: true,
    },
    {
      label: "Avg Engagement",
      value: data ? `${(data.avgEngagementRate * 100).toFixed(2)}%` : "—",
      icon: TrendingUp,
      trend: "+0.4%",
      positive: true,
    },
    {
      label: "Total Clips",
      value: clipsData?.total.toLocaleString() ?? "—",
      icon: Film,
      trend: "+8",
      positive: true,
    },
    {
      label: "Published",
      value: data?.platformBreakdown.reduce((s, p) => s + p.clipCount, 0).toLocaleString() ?? "—",
      icon: Send,
      trend: "+3",
      positive: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="rounded-xl border border-border bg-card p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <stat.icon className="h-4 w-4 text-muted-foreground" />
            <span className={`text-xs font-medium ${stat.positive ? "text-green-400" : "text-red-400"}`}>
              {stat.trend}
            </span>
          </div>
          <p className="text-2xl font-bold">{stat.value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
        </motion.div>
      ))}
    </div>
  );
}
