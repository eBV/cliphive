"use client";

import { trpc } from "../../../lib/trpc";
import { TEMPLATE_CATEGORY_META } from "@cliphive/shared";
import type { TemplateCategory } from "@cliphive/shared";
import { Layers, Zap } from "lucide-react";

export default function TemplatesPage() {
  const { data: templates } = trpc.template.list.useQuery({});

  const grouped = templates?.reduce<Record<TemplateCategory, typeof templates>>((acc, t) => {
    const cat = t.category ?? "talking_head";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {} as any) ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
        <p className="text-muted-foreground">
          Platform-optimized visual treatments for your clips.
        </p>
      </div>

      {Object.entries(grouped).map(([category, tmplates]) => {
        const meta = TEMPLATE_CATEGORY_META[category as TemplateCategory];
        return (
          <div key={category}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {meta?.label ?? category}
            </h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {(tmplates as any[]).map((t: any) => (
                <div
                  key={t.id}
                  className="rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors cursor-pointer"
                >
                  <div className="mb-3 flex h-24 items-center justify-center rounded-lg bg-black/30">
                    <Layers className="h-8 w-8 text-primary/40" />
                  </div>
                  <p className="text-sm font-medium">{t.name}</p>
                  {t.viralityAvg && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-yellow-400">
                      <Zap className="h-3 w-3" />
                      {Math.round(t.viralityAvg * 100)}% avg virality
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
