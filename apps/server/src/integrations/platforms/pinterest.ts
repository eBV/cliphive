/**
 * Pinterest API v5 integration — Idea Pins (video).
 */
import axios from "axios";

const PINTEREST_API = "https://api.pinterest.com/v5";

export interface PinterestUploadResult {
  platformPostId: string;
}

export async function publishToPinterest(params: {
  accessToken: string;
  boardId: string;
  videoUrl: string;
  title: string;
  description: string;
  hashtags: string[];
}): Promise<PinterestUploadResult> {
  const description = `${params.description}\n\n${params.hashtags.join(" ")}`.slice(0, 500);

  const { data } = await axios.post(
    `${PINTEREST_API}/pins`,
    {
      board_id: params.boardId,
      title: params.title.slice(0, 100),
      description,
      media_source: {
        source_type: "video_id",
        content_type: "video/mp4",
        url: params.videoUrl,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  return { platformPostId: data.id };
}

// ── Class-based wrapper ───────────────────────────────────────────────

import { withRetry, CircuitBreaker } from "../../utils/retry.js";

const _pinBreaker = new CircuitBreaker(5, 120000);

export class PinterestIntegration {
  async createIdeaPin(
    accessToken: string,
    videoBuffer: Buffer,
    caption: string,
    platformUserId: string
  ): Promise<{ platformPostId: string; publishedAt: Date }> {
    const { StorageService } = await import("../storage.js");
    const storage = new StorageService();
    const tmpKey = `tmp/pinterest/${Date.now()}.mp4`;
    await storage.uploadBuffer(tmpKey, videoBuffer, "video/mp4");
    const videoUrl = await storage.getPresignedDownloadUrl(tmpKey, 3600);

    const result = await withRetry(
      () =>
        _pinBreaker.execute(() =>
          publishToPinterest({
            accessToken,
            boardId: platformUserId,
            videoUrl,
            title: caption.slice(0, 100),
            description: caption.slice(0, 500),
            hashtags: [],
          })
        ),
      { attempts: 3, delayMs: 5000, backoff: "exponential" }
    );
    return { platformPostId: result.platformPostId, publishedAt: new Date() };
  }
}
