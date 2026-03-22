"use client";

import { useState } from "react";
import { UploadDropzone } from "../../../components/shared/UploadDropzone";
import { UrlImport } from "../../../components/shared/UrlImport";

type UploadMethod = "file" | "url";

export default function UploadPage() {
  const [method, setMethod] = useState<UploadMethod>("file");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload Source Media</h1>
        <p className="text-muted-foreground">
          Upload a video file or import from YouTube, Twitch, or a podcast RSS feed.
        </p>
      </div>

      {/* Method tabs */}
      <div className="flex gap-2 rounded-lg border border-border p-1">
        {(["file", "url"] as UploadMethod[]).map((m) => (
          <button
            key={m}
            onClick={() => setMethod(m)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              method === m
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "file" ? "Upload File" : "Import from URL"}
          </button>
        ))}
      </div>

      {method === "file" ? <UploadDropzone /> : <UrlImport />}
    </div>
  );
}
