/** Analytics and performance tracking types. */
export interface Analytics {
  id: string;
  publicationId: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watchTimeSeconds: number;
  avgWatchPercentage: number;
  reach: number;
  engagementRate: number;
  fetchedAt: string;
}

export interface AggregatedAnalytics {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  avgEngagementRate: number;
  avgWatchPercentage: number;
  totalReach: number;
  topClipId: string | null;
  platformBreakdown: PlatformAnalytics[];
  timeSeries: TimeSeriesPoint[];
}

export interface PlatformAnalytics {
  platform: string;
  views: number;
  engagementRate: number;
  avgWatchPercentage: number;
  clipCount: number;
}

export interface TimeSeriesPoint {
  date: string;
  views: number;
  engagementRate: number;
  clipsPublished: number;
}

export interface AnalyticsFetchResult {
  publicationId: string;
  platform: string;
  data: Omit<Analytics, "id" | "publicationId" | "fetchedAt">;
  success: boolean;
  error?: string;
}
