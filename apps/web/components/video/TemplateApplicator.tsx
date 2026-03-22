"use client";

import { trpc } from "../../lib/trpc";
import type { Clip } from "@cliphive/shared";
import { TEMPLATE_CATEGORY_META } from "@cliphive/shared";

interface Props {
  clip: Clip;
}

export function TemplateApplicator({ clip }: Props) {
  const { data: templates } = trpc.template.list.useQuery({});
  const updateMutation = trpc.clip.update.useMutation();

  function applyTemplate(templateId: string) {
    updateMutation.mutate({ id: clip.id, templateId });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Template</h3>
        {clip.templateId && (
          <span className="text-xs text-primary">Applied ✓</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {templates?.map((t) => {
          const meta = TEMPLATE_CATEGORY_META[t.category ?? "talking_head"];
          const isSelected = clip.templateId === t.id;
          return (
            <button
              key={t.id}
              onClick={() => applyTemplate(t.id)}
              className={`rounded-lg border p-3 text-left text-xs transition-colors ${
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <p className={`font-medium ${isSelected ? "text-primary" : ""}`}>
                {t.name}
              </p>
              <p className="mt-0.5 text-muted-foreground truncate">
                {meta?.description ?? ""}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
