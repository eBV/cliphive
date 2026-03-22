/**
 * Snapchat Spotlight integration via Snap Kit Creative Kit.
 */
import axios from "axios";

const SNAPCHAT_API = "https://adsapi.snapchat.com/v1";

export interface SnapchatUploadResult {
  platformPostId: string;
}

export async function publishToSnapchat(params: {
  accessToken: string;
  videoUrl: string;
  topics: string[];
}): Promise<SnapchatUploadResult> {
  // Snapchat Spotlight submission via Creative Kit
  const { data } = await axios.post(
    `${SNAPCHAT_API}/media/spotlight`,
    {
      video_url: params.videoUrl,
      topics: params.topics.slice(0, 3),
    },
    {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  return { platformPostId: data.id ?? "snapchat-post" };
}

// ── Class-based wrapper ───────────────────────────────────────────────

import { withRetry, CircuitBreaker } from "../../utils/retry.js";

const _snapBreaker = new CircuitBreaker(5, 120000);

export class SnapchatIntegration {
  async uploadSpotlight(
    accessToken: string,
    videoBuffer: Buffer,
    caption: string
  ): Promise<{ platformPostId: string; publishedAt: Date }> {
    const { StorageService } = await import("../storage.js");
    const storage = new StorageService();
    const tmpKey = `tmp/snapchat/${Date.now()}.mp4`;
    await storage.uploadBuffer(tmpKey, videoBuffer, "video/mp4");
    const videoUrl = await storage.getPresignedDownloadUrl(tmpKey, 3600);

    const result = await withRetry(
      () =>
        _snapBreaker.execute(() =>
          publishToSnapchat({
            accessToken,
            videoUrl,
            topics: caption.split(" ").filter((w) => w.startsWith("#")).map((w) => w.slice(1)).slice(0, 3),
          })
        ),
      { attempts: 3, delayMs: 5000, backoff: "exponential" }
    );
    return { platformPostId: result.platformPostId, publishedAt: new Date() };
  }
}
