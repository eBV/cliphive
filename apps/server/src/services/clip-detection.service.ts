import axios from "axios";
import { eq } from "drizzle-orm";
import { createDb, clips, sourceMedia, viralityFeedbackLoop } from "@cliphive/db";
import type { ClipCandidate, ViralityScore } from "@cliphive/shared";
import { VIRALITY_THRESHOLDS } from "@cliphive/shared";
import { config } from "../config.js";
import { renderQueue } from "../jobs/queue.js";
import { withRetry, CircuitBreaker } from "../utils/retry.js";
import { getSocketIO } from "../index.js";

interface MLDetectResponse {
  candidates: ClipCandidate[];
  model_version: string;
  processing_time_ms: number;
}

interface MLRescoreResponse {
  virality_score: ViralityScore;
  model_version: string;
}

export class ClipDetectionService {
  private readonly db: ReturnType<typeof createDb>;
  private readonly mlBreaker: CircuitBreaker;

  constructor() {
    this.db = createDb(config.DATABASE_URL);
    this.mlBreaker = new CircuitBreaker(5, 60000);
  }

  private get mlHeaders() {
    return config.ML_API_KEY
      ? { Authorization: `Bearer ${config.ML_API_KEY}` }
      : {};
  }

  /**
   * Call ML service to detect clip candidates, persist them, and optionally
   * trigger rendering for auto-approved clips.
   */
  async detectClips(mediaId: string, userId: string): Promise<void> {
    const [media] = await this.db
      .select()
      .from(sourceMedia)
      .where(eq(sourceMedia.id, mediaId))
      .limit(1);

    if (!media) throw new Error(`Media not found: ${mediaId}`);
    if (!media.s3Key) throw new Error(`Media ${mediaId} has no s3Key`);

    const mediaUrl = `${config.CDN_BASE_URL}/${media.s3Key}`;

    const response = await withRetry<{ data: MLDetectResponse }>(
      () =>
        this.mlBreaker.execute(() =>
          axios.post<MLDetectResponse>(
            `${config.ML_SERVICE_URL}/detect-clips`,
            {
              media_id: mediaId,
              media_url: mediaUrl,
              transcript: media.transcript ?? null,
              transcript_segments: media.transcriptSegments ?? null,
              scene_graph: media.sceneGraph ?? null,
              max_clips: 20,
            },
            { timeout: 300000, headers: this.mlHeaders }
          )
        ),
      { attempts: 3, delayMs: 5000, backoff: "exponential" }
    );

    const { candidates } = response.data;

    if (candidates.length === 0) {
      console.info(`[ClipDetection] No candidates found for mediaId=${mediaId}`);
      return;
    }

    // Persist clip candidates
    const insertedClips = await this.db
      .insert(clips)
      .values(
        candidates.map((c) => ({
          userId,
          sourceMediaId: mediaId,
          title: c.transcriptSnippet
            ? c.transcriptSnippet.slice(0, 100)
            : `Clip ${Math.round(c.startTime)}s–${Math.round(c.endTime)}s`,
          startTime: c.startTime,
          endTime: c.endTime,
          durationSeconds: c.durationSeconds,
          viralityScore: c.viralityScore,
          hookScore: c.hookScore,
          energyScore: c.energyScore,
          emotionTags: c.emotionTags,
          transcriptSnippet: c.transcriptSnippet,
          status: "detected" as const,
        }))
      )
      .returning();

    // Insert feature vectors into feedback loop table
    await this.db.insert(viralityFeedbackLoop).values(
      insertedClips
        .filter((_, i) => candidates[i]?.featureVector?.length)
        .map((clip, i) => ({
          clipId: clip.id,
          predictedVirality: clip.viralityScore ?? 0,
          featuresVector: candidates[i]!.featureVector,
        }))
    );

    // Auto-queue rendering for high-scoring clips
    const autoApprove = VIRALITY_THRESHOLDS.autoApprove;
    const highScoreClips = insertedClips.filter(
      (c) => (c.viralityScore ?? 0) >= autoApprove
    );

    if (highScoreClips.length > 0) {
      const renderJobs = highScoreClips.flatMap((clip) =>
        (["tiktok", "instagram", "youtube"] as const).map((platform) => ({
          name: "render",
          data: { clipId: clip.id, platform, userId },
          opts: {
            attempts: 3,
            backoff: { type: "exponential" as const, delay: 5000 },
          },
        }))
      );

      await renderQueue.addBulk(renderJobs);

      await this.db
        .update(clips)
        .set({ status: "queued" })
        .where(
          eq(
            clips.id,
            highScoreClips[0]!.id // drizzle limitation: update one by one in loop
          )
        );

      // Update all high-score clips
      for (const clip of highScoreClips) {
        await this.db
          .update(clips)
          .set({ status: "queued" })
          .where(eq(clips.id, clip.id));
      }
    }

    // Notify via Socket.IO
    try {
      const io = getSocketIO();
      io.to(`user:${userId}`).emit("clips:detected", {
        mediaId,
        count: insertedClips.length,
        autoQueued: highScoreClips.length,
      });
    } catch {
      // Socket not available (e.g., in tests)
    }

    console.info(
      `[ClipDetection] Detected ${insertedClips.length} clips (${highScoreClips.length} auto-queued) for mediaId=${mediaId}`
    );
  }

  /**
   * Re-score a single clip by calling the ML rescore endpoint.
   */
  async rescoreClip(clipId: string, mediaId: string): Promise<ViralityScore> {
    const response = await withRetry<{ data: MLRescoreResponse }>(
      () =>
        this.mlBreaker.execute(() =>
          axios.post<MLRescoreResponse>(
            `${config.ML_SERVICE_URL}/rescore-clip`,
            { clip_id: clipId, media_id: mediaId },
            { timeout: 60000, headers: this.mlHeaders }
          )
        ),
      { attempts: 3, delayMs: 2000, backoff: "exponential" }
    );

    return response.data.virality_score;
  }
}
