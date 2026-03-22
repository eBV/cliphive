import axios from "axios";
import { eq, gte, and, isNotNull } from "drizzle-orm";
import { createDb, viralityFeedbackLoop, analytics, publications, renderedClips, clips } from "@cliphive/db";
import type { ModelTrainingStatus } from "@cliphive/shared";
import { config } from "../config.js";
import { withRetry, CircuitBreaker } from "../utils/retry.js";

interface FeedbackEntry {
  clipId: string;
  predictedVirality: number;
  actualViews: number;
  actualEngagementRate: number;
  featureVector: number[];
}

interface RetrainRequest {
  feedback_entries: Array<{
    clip_id: string;
    predicted_virality: number;
    actual_total_views: number;
    actual_engagement_rate: number;
    features_vector: number[];
  }>;
  trigger: "scheduled" | "manual";
}

export class ViralityOptimizerService {
  private readonly db: ReturnType<typeof createDb>;
  private readonly mlBreaker: CircuitBreaker;

  constructor() {
    this.db = createDb(config.DATABASE_URL);
    this.mlBreaker = new CircuitBreaker(3, 300000);
  }

  private get mlHeaders() {
    return {
      "Content-Type": "application/json",
      ...(config.ML_API_KEY
        ? { Authorization: `Bearer ${config.ML_API_KEY}` }
        : {}),
    };
  }

  /**
   * Collect actual performance data, populate feedback loop table,
   * and trigger ML /retrain endpoint.
   */
  async runRetrainCycle(trigger: "scheduled" | "manual" = "scheduled"): Promise<ModelTrainingStatus> {
    console.info("[ViralityOptimizer] Starting retrain cycle…");

    const feedback = await this.collectFeedback();
    if (feedback.length === 0) {
      console.info("[ViralityOptimizer] No feedback data available. Skipping retrain.");
      return { status: "idle" };
    }

    await this.updateFeedbackLoop(feedback);

    const status = await this.callRetrainEndpoint(feedback, trigger);
    console.info("[ViralityOptimizer] Retrain triggered. Status:", status);
    return status;
  }

  private async collectFeedback(): Promise<FeedbackEntry[]> {
    // Get feedback loop entries from last 30 days that have actual analytics
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const entries = await this.db
      .select({
        id: viralityFeedbackLoop.id,
        clipId: viralityFeedbackLoop.clipId,
        predictedVirality: viralityFeedbackLoop.predictedVirality,
        actualTotalViews: viralityFeedbackLoop.actualTotalViews,
        actualEngagementRate: viralityFeedbackLoop.actualEngagementRate,
        featuresVector: viralityFeedbackLoop.featuresVector,
      })
      .from(viralityFeedbackLoop)
      .where(
        and(
          gte(viralityFeedbackLoop.createdAt, cutoff),
          isNotNull(viralityFeedbackLoop.featuresVector)
        )
      )
      .limit(1000);

    // Enrich with actual metrics from analytics table
    const enriched: FeedbackEntry[] = [];

    for (const entry of entries) {
      if (!entry.featuresVector) continue;

      // If we already have actual metrics, use them
      if (entry.actualTotalViews !== null && entry.actualEngagementRate !== null) {
        enriched.push({
          clipId: entry.clipId,
          predictedVirality: entry.predictedVirality,
          actualViews: entry.actualTotalViews,
          actualEngagementRate: entry.actualEngagementRate,
          featureVector: entry.featuresVector,
        });
        continue;
      }

      // Fetch actual metrics from analytics
      const clipAnalytics = await this.db
        .select({
          views: analytics.views,
          engagementRate: analytics.engagementRate,
        })
        .from(analytics)
        .innerJoin(publications, eq(analytics.publicationId, publications.id))
        .innerJoin(renderedClips, eq(publications.renderedClipId, renderedClips.id))
        .where(eq(renderedClips.clipId, entry.clipId))
        .limit(10);

      if (clipAnalytics.length === 0) continue;

      const totalViews = clipAnalytics.reduce((sum, a) => sum + a.views, 0);
      const avgEngagement =
        clipAnalytics.reduce((sum, a) => sum + a.engagementRate, 0) /
        clipAnalytics.length;

      enriched.push({
        clipId: entry.clipId,
        predictedVirality: entry.predictedVirality,
        actualViews: totalViews,
        actualEngagementRate: avgEngagement,
        featureVector: entry.featuresVector,
      });
    }

    return enriched;
  }

  private async updateFeedbackLoop(feedback: FeedbackEntry[]): Promise<void> {
    for (const entry of feedback) {
      await this.db
        .update(viralityFeedbackLoop)
        .set({
          actualTotalViews: entry.actualViews,
          actualEngagementRate: entry.actualEngagementRate,
        })
        .where(eq(viralityFeedbackLoop.clipId, entry.clipId));
    }
  }

  private async callRetrainEndpoint(
    feedback: FeedbackEntry[],
    trigger: "scheduled" | "manual"
  ): Promise<ModelTrainingStatus> {
    const payload: RetrainRequest = {
      feedback_entries: feedback.map((f) => ({
        clip_id: f.clipId,
        predicted_virality: f.predictedVirality,
        actual_total_views: f.actualViews,
        actual_engagement_rate: f.actualEngagementRate,
        features_vector: f.featureVector,
      })),
      trigger,
    };

    const response = await withRetry<{ data: ModelTrainingStatus }>(
      () =>
        this.mlBreaker.execute(() =>
          axios.post<ModelTrainingStatus>(
            `${config.ML_SERVICE_URL}/retrain`,
            payload,
            { timeout: 600000, headers: this.mlHeaders }
          )
        ),
      { attempts: 3, delayMs: 10000, backoff: "exponential" }
    );

    return response.data;
  }

  async getTrainingStatus(): Promise<ModelTrainingStatus> {
    try {
      const response = await withRetry<{ data: ModelTrainingStatus }>(
        () =>
          axios.get<ModelTrainingStatus>(
            `${config.ML_SERVICE_URL}/training-status`,
            { timeout: 30000, headers: this.mlHeaders }
          ),
        { attempts: 3, delayMs: 1000, backoff: "linear" }
      );
      return response.data;
    } catch {
      return { status: "idle" };
    }
  }
}
