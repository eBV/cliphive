"use client";

import { use } from "react";
import { trpc } from "../../../../lib/trpc";
import { ClipPreview } from "../../../../components/video/ClipPreview";
import { TemplateApplicator } from "../../../../components/video/TemplateApplicator";
import { CaptionOverlay } from "../../../../components/video/CaptionOverlay";
import { PlatformSelector } from "../../../../components/publish/PlatformSelector";
import { ViralityScorePanel } from "../../../../components/video/ViralityScorePanel";

export default function ClipEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: clip, isLoading } = trpc.clip.getById.useQuery({ id });

  if (isLoading) {
    return (
      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-3 h-[600px] animate-pulse rounded-xl bg-card" />
        <div className="col-span-2 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      </div>
    );
  }

  if (!clip) {
    return <div className="py-20 text-center text-muted-foreground">Clip not found.</div>;
  }

  return (
    <div className="grid grid-cols-5 gap-6">
      {/* Left: Preview + Caption editor */}
      <div className="col-span-3 space-y-4">
        <ClipPreview clip={clip} />
        <CaptionOverlay clip={clip} />
      </div>

      {/* Right: Template, score, publish */}
      <div className="col-span-2 space-y-4">
        <ViralityScorePanel clip={clip} />
        <TemplateApplicator clip={clip} />
        <PlatformSelector clipId={clip.id} />
      </div>
    </div>
  );
}
