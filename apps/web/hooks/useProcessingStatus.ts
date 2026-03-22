"use client";

import { useEffect, useState } from "react";
import { connectSocket } from "../lib/socket";
import type { MediaProcessingStatus, ClipStatus } from "@cliphive/shared";

interface ProcessingEvent {
  mediaId?: string;
  clipId?: string;
  status: MediaProcessingStatus | ClipStatus;
  progress?: number;
  message?: string;
}

/**
 * Subscribe to real-time processing status updates for a media item or clip.
 */
export function useProcessingStatus(mediaId?: string) {
  const [events, setEvents] = useState<ProcessingEvent[]>([]);
  const [latestStatus, setLatestStatus] = useState<MediaProcessingStatus | null>(null);

  useEffect(() => {
    if (!mediaId) return;

    const socket = connectSocket();

    // Subscribe to media room
    socket.emit("subscribe:media", mediaId);

    const handleUpdate = (event: ProcessingEvent) => {
      if (event.mediaId !== mediaId) return;
      setEvents((prev) => [...prev, event]);
      setLatestStatus(event.status as MediaProcessingStatus);

      if (event.status === "ready") {
        socket.emit("unsubscribe:media", mediaId);
      }
    };

    socket.on("media:status", handleUpdate);

    return () => {
      socket.off("media:status", handleUpdate);
      socket.emit("unsubscribe:media", mediaId);
    };
  }, [mediaId]);

  return { events, latestStatus };
}
