"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Zap, Clock, Play } from "lucide-react";
import type { Clip } from "@cliphive/shared";
import { formatTimestamp, formatDuration } from "@cliphive/shared";
import { viralityDisplay } from "../../lib/utils";
import { ProcessingStatusBadge } from "../shared/ProcessingStatusBadge";

interface Props {
  clip: Clip;
}

export function ClipCard({ clip }: Props) {
  const virality = clip.viralityScore !== null ? viralityDisplay(clip.viralityScore) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
    >
      <Link href={`/clips/${clip.id}`}>
        <div className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-colors">
          {/* Thumbnail area */}
          <div className="relative aspect-video bg-black/40 flex items-center justify-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 group-hover:bg-primary/80 transition-colors">
              <Play className="h-5 w-5 text-white ml-0.5" />
            </div>

            {/* Duration badge */}
            <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/70 px-2 py-0.5 text-xs text-white">
              <Clock className="h-3 w-3" />
              {formatDuration(clip.durationSeconds)}
            </div>

            {/* Virality badge */}
            {virality && (
              <div className={`absolute top-2 left-2 flex items-center gap-1 rounded-md bg-black/70 px-2 py-0.5 text-xs font-bold ${virality.colorClass}`}>
                <Zap className="h-3 w-3" />
                {virality.label}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-3">
            <p className="text-sm font-medium line-clamp-2">
              {clip.title || clip.transcriptSnippet || "Untitled clip"}
            </p>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {formatTimestamp(clip.startTime)} – {formatTimestamp(clip.endTime)}
              </span>
              <ProcessingStatusBadge status={clip.status} />
            </div>

            {/* Emotion tags */}
            {clip.emotionTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {clip.emotionTags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-accent px-2 py-0.5 text-xs capitalize text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
