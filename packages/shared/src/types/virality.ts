/** Virality scoring and analysis types. */
export interface ViralityScore {
  overall: number;
  hookScore: number;
  retentionPrediction: number;
  audioEnergyScore: number;
  emotionIntensity: number;
  quotabilityScore: number;
  visualDynamism: number;
  loopScore: number;
  trendAlignment: number;
}

export interface ViralityScoreBreakdown extends ViralityScore {
  clipId: string;
  computedAt: string;
  modelVersion: string;
}

export interface ViralityThreshold {
  autoApprove: number;
  suggest: number;
  discard: number;
}

export interface FeedbackLoopEntry {
  id: string;
  clipId: string;
  predictedVirality: number;
  actualTotalViews: number;
  actualEngagementRate: number;
  featuresVector: number[];
  createdAt: string;
}

export interface ModelTrainingStatus {
  status: "idle" | "training" | "evaluating" | "complete" | "failed";
  currentEpoch?: number;
  totalEpochs?: number;
  trainingLoss?: number;
  validationAccuracy?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface TrendingSound {
  id: string;
  platform: string;
  soundName: string;
  artist: string;
  soundUrl: string;
  usageCount: number;
  trendingRank: number;
  fetchedAt: string;
}

export interface TrendingHashtag {
  id: string;
  platform: string;
  hashtag: string;
  volume: number;
  velocity: number;
  category: string;
  fetchedAt: string;
}
