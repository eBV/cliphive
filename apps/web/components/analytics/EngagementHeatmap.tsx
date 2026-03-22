"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { PlatformAnalytics } from "@cliphive/shared";

interface Props {
  platformData: PlatformAnalytics[];
}

const PLATFORM_COLORS: Record<string, string> = {
  tiktok: "#ff0050",
  instagram: "#e1306c",
  youtube: "#ff0000",
  twitter: "#1da1f2",
  facebook: "#1877f2",
  linkedin: "#0a66c2",
  snapchat: "#fffc00",
  pinterest: "#e60023",
};

export function EngagementHeatmap({ platformData }: Props) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="font-semibold mb-4">Platform Engagement Rate</h3>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={platformData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="platform"
            tick={{ fontSize: 11, fill: "#71717a" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => `${(v * 100).toFixed(1)}%`}
            tick={{ fontSize: 11, fill: "#71717a" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
            formatter={(v: number) => [`${(v * 100).toFixed(2)}%`, "Engagement"]}
          />
          <Bar dataKey="engagementRate" radius={[4, 4, 0, 0]}>
            {platformData.map((entry) => (
              <Cell
                key={entry.platform}
                fill={PLATFORM_COLORS[entry.platform] ?? "#f97316"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
