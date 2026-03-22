"use client";

import { useState, useCallback } from "react";
import * as tus from "tus-js-client";
import { trpc } from "../lib/trpc";

type UploadStatus = "idle" | "uploading" | "processing" | "complete" | "error";

interface UseVideoUploadReturn {
  upload: (file: File) => void;
  progress: number;
  status: UploadStatus;
  error: string | null;
  mediaId: string | null;
  reset: () => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function useVideoUpload(): UseVideoUploadReturn {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);

  const createMediaMutation = trpc.media.create.useMutation();

  const upload = useCallback(
    (file: File) => {
      setStatus("uploading");
      setProgress(0);
      setError(null);
      setMediaId(null);

      // First create the media record
      createMediaMutation.mutate(
        {
          sourceType: "upload",
          title: file.name.replace(/\.[^.]+$/, ""),
        },
        {
          onSuccess: (media) => {
            setMediaId(media.id);

            // Start TUS resumable upload
            const upload = new tus.Upload(file, {
              endpoint: `${API_URL}/upload`,
              retryDelays: [0, 1000, 3000, 5000],
              chunkSize: 5 * 1024 * 1024, // 5 MB chunks
              metadata: {
                filename: file.name,
                filetype: file.type,
                mediaId: media.id,
              },
              onError(err) {
                setStatus("error");
                setError(err.message);
              },
              onProgress(bytesUploaded, bytesTotal) {
                const pct = Math.round((bytesUploaded / bytesTotal) * 100);
                setProgress(pct);
              },
              onSuccess() {
                setStatus("processing");
                // Processing status is tracked via Socket.IO (useProcessingStatus hook)
              },
            });

            upload.start();
          },
          onError: (err) => {
            setStatus("error");
            setError(err.message);
          },
        }
      );
    },
    [createMediaMutation]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress(0);
    setError(null);
    setMediaId(null);
  }, []);

  return { upload, progress, status, error, mediaId, reset };
}
