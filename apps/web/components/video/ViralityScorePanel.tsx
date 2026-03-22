"use client";

import { motion } from "framer-motion";
import { Zap, TrendingUp, Volume2, Eye, Quote, Layers, RefreshCw } from "lucide-react";
import type { Clip } from "@cliphive/shared";
import { VIRALITY_SCORE_WEIGHTS } from "@cliphive/shared";
import { viralityDisplay } from "../../lib/utils";
import { trpc } from "../../lib/trpc";

interface Props {
  clip: Clip;
}

const SCORE_COMPONENTS = [
  { key: "hookScore", icon: Zap, label: "Hook (first 3s)", weight: VIRALITY_SCORE_WEIGHTS.hookScore },
  { key: "retentionPrediction", icon: TrendingUp, label: "Retention", weight: VIRALITY_SCORE_WEIGHTS.retentionPrediction },
  { key: "audioEnergyScore", icon: Volume2, label: "Audio Energy", weight: VIRALITY_SCORE_WEIGHTS.audioEnergyScore },
  { key: "emotionIntensity", icon: Eye, label: "Emotion", weight: VIRALITY_SCORE_WEIGHTS.emotionIntensity },
  { key: "quotabilityScore", icon: Quote, label: "Quotability", weight: VIRALITY_SCORE_WEIGHTS.quotabilityScore },
  { key: "visualDynamism", icon: Layers, label: "Visual Dynamism", weight: VIRALITY_SCORE_WEIGHTS.visualDynamism },
] as const;

export function ViralityScorePanel({ clip }: Props) {
  const score = clip.viralityScore ?? 0;
  const virality = viralityDisplay(score);
  const rescoreMutation = trpc.clip.rescore.useMutation();

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Virality Score</h3>
        <button
          onClick={() => rescoreMutation.mutate({ id: clip.id })}
          disabled={rescoreMutation.isPending}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${rescoreMutation.isPending ? "animate-spin" : ""}`} />
          Rescore
        </button>
      </div>

      {/* Big score */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative h-16 w-16">
          <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-border" />
            <motion.circle
              cx="18"
              cy="18"
              r="15.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeDasharray={`${score * 100}, 100`}
              strokeLinecap="round"
              className={virality.colorClass}
              initial={{ strokeDasharray: "0, 100" }}
              animate={{ strokeDasharray: `${score * 100}, 100` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-xs font-bold ${virality.colorClass}`}>
              {Math.round(score * 100)}
            </span>
          </div>
        </div>
        <div>
          <p className={`text-xl font-bold ${virality.colorClass}`}>{virality.label}</p>
          <p className="text-xs text-muted-foreground capitalize">
            {virality.tier === "high" ? "🚀 Auto-queued" : virality.tier === "medium" ? "⚠️ Review suggested" : "❌ Low potential"}
          </p>
        </div>
      </div>

      {/* Component bars */}
      <div className="space-y-2">
        {SCORE_COMPONENTS.map(({ key, icon: Icon, label, weight }) => {
          const value = key === "hookScore" ? (clip.hookScore ?? 0) : key === "audioEnergyScore" ? (clip.energyScore ?? 0) : 0;
          return (
            <div key={key} className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground w-24 flex-shrink-0">{label}</span>
              <div className="flex-1 h-1.5 rounded-full bg-border">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${value * 100}%` }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-8 text-right">
                {Math.round(value * 100)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
