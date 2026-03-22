"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TimeSeriesPoint } from "@cliphive/shared";
import { format, parseISO } from "date-fns";

interface Props {
  data: TimeSeriesPoint[];
  isLoading?: boolean;
}

export function ViewsChart({ data, isLoading }: Props) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="font-semibold mb-4">Views Over Time</h3>
      {isLoading ? (
        <div className="h-48 animate-pulse rounded-lg bg-accent" />
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => format(parseISO(v), "MMM d")}
              tick={{ fontSize: 11, fill: "#71717a" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#71717a" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
              labelFormatter={(v) => format(parseISO(v as string), "MMM d, yyyy")}
              formatter={(v: number) => [v.toLocaleString(), "Views"]}
            />
            <Area
              type="monotone"
              dataKey="views"
              stroke="#f97316"
              strokeWidth={2}
              fill="url(#viewsGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
