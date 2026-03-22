import { cn } from "../../lib/utils";
import type { MediaProcessingStatus, ClipStatus } from "@cliphive/shared";

type Status = MediaProcessingStatus | ClipStatus;

const STATUS_CONFIG: Record<Status, { label: string; className: string }> = {
  uploading: { label: "Uploading", className: "bg-blue-500/10 text-blue-400" },
  transcribing: { label: "Transcribing", className: "bg-purple-500/10 text-purple-400" },
  analyzing: { label: "Analyzing", className: "bg-yellow-500/10 text-yellow-400" },
  ready: { label: "Ready", className: "bg-green-500/10 text-green-400" },
  error: { label: "Error", className: "bg-red-500/10 text-red-400" },
  detected: { label: "Detected", className: "bg-blue-500/10 text-blue-400" },
  queued: { label: "Queued", className: "bg-yellow-500/10 text-yellow-400" },
  rendering: { label: "Rendering", className: "bg-orange-500/10 text-orange-400" },
  rendered: { label: "Rendered", className: "bg-green-500/10 text-green-400" },
  published: { label: "Published", className: "bg-emerald-500/10 text-emerald-400" },
  failed: { label: "Failed", className: "bg-red-500/10 text-red-400" },
};

interface Props {
  status: Status;
  className?: string;
}

export function ProcessingStatusBadge({ status, className }: Props) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: "bg-gray-500/10 text-gray-400" };
  const isActive = ["uploading", "transcribing", "analyzing", "rendering", "queued"].includes(status);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        config.className,
        className
      )}
    >
      {isActive && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
        </span>
      )}
      {config.label}
    </span>
  );
}
