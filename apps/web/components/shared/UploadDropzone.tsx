"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileVideo, X, CheckCircle } from "lucide-react";
import { useVideoUpload } from "../../hooks/useVideoUpload";
import { formatFileSize } from "../../lib/utils";

const ACCEPTED_TYPES = {
  "video/*": [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"],
  "audio/*": [".mp3", ".wav", ".m4a", ".ogg", ".aac"],
};

export function UploadDropzone() {
  const { upload, progress, status, error, reset } = useVideoUpload();
  const [file, setFile] = useState<File | null>(null);

  const onDrop = useCallback(
    (accepted: File[]) => {
      const f = accepted[0];
      if (!f) return;
      setFile(f);
      upload(f);
    },
    [upload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024 * 1024, // 10 GB
    disabled: status === "uploading" || status === "processing",
  });

  if (status === "complete") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/5 p-10 text-center">
        <CheckCircle className="h-12 w-12 text-green-400" />
        <p className="font-semibold text-green-400">Upload complete!</p>
        <p className="text-sm text-muted-foreground">
          Your media is being processed. Clips will appear shortly.
        </p>
        <button
          onClick={reset}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Upload Another
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`flex flex-col items-center gap-4 rounded-xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer ${
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        }`}
      >
        <input {...getInputProps()} />
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Upload className="h-8 w-8 text-primary" />
        </div>
        <div>
          <p className="font-semibold">
            {isDragActive ? "Drop your video here" : "Drag & drop your video"}
          </p>
          <p className="text-sm text-muted-foreground">
            or click to browse — MP4, MOV, MKV, WebM up to 10 GB
          </p>
        </div>
      </div>

      {/* File info + progress */}
      {file && (status === "uploading" || status === "processing") && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <FileVideo className="h-8 w-8 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
            </div>
          </div>

          {status === "uploading" && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Uploading…</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {status === "processing" && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>Processing media…</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
