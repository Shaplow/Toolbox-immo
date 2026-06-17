"use client";

/**
 * JobQueueItem — item de liste de jobs (render, captions, autocut, etc.).
 *
 * Flat shadcn :
 * - Card bg-card border-border.
 * - Status tint via border-l-4 semantic (in_progress=primary, done=success, failed=danger).
 * - Hover lift léger sur bg-muted.
 */

import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { Progress } from "../Progress";
import type { StatusDomain } from "@/lib/ui/statusMapping";

interface JobMeta {
  id: string;
  domain: StatusDomain;
  status: string;
  title: ReactNode;
  description?: ReactNode;
  progress?: number;
  createdAt?: Date | string;
  startedAt?: Date | string;
  endedAt?: Date | string;
  error?: string;
}

interface JobQueueItemProps {
  job: JobMeta;
  actions?: ReactNode;
  onClick?: () => void;
  compact?: boolean;
  className?: string;
}

const STATUS_ACCENT: Record<string, string> = {
  IN_PROGRESS: "border-l-primary",
  GENERATING:  "border-l-primary",
  RUNNING:     "border-l-primary",
  RENDERING:   "border-l-primary",
  UPLOADING:   "border-l-primary",
  COMPLETED:   "border-l-success-600",
  READY:       "border-l-success-600",
  DONE:        "border-l-success-600",
  FAILED:      "border-l-danger-600",
  ERROR:       "border-l-danger-600",
};

function formatTime(d?: Date | string): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(start?: Date | string, end?: Date | string): string {
  if (!start || !end) return "";
  const s = typeof start === "string" ? new Date(start) : start;
  const e = typeof end === "string" ? new Date(end) : end;
  if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) return "";
  const ms = e.getTime() - s.getTime();
  if (ms < 0) return "";
  const totalSec = Math.floor(ms / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  if (mm < 1) return `${ss}s`;
  return `${mm}m ${String(ss).padStart(2, "0")}s`;
}

export function JobQueueItem({
  job,
  actions,
  onClick,
  compact = false,
  className,
}: JobQueueItemProps) {
  const accentCls = STATUS_ACCENT[job.status] ?? "border-l-border";
  const interactive = !!onClick;

  return (
    <article
      onClick={interactive ? onClick : undefined}
      className={[
        "rounded-md px-4 py-3 transition-colors bg-card border border-border border-l-4",
        accentCls,
        interactive ? "cursor-pointer hover:bg-muted" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge domain={job.domain} status={job.status} size="sm" />
            <p className="text-[13px] font-semibold text-foreground truncate leading-tight">
              {job.title}
            </p>
          </div>
          {job.description && !compact && (
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              {job.description}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0 flex items-center gap-1.5">{actions}</div>}
      </div>

      {job.progress !== undefined && !compact && (
        <div className="mt-2.5">
          <Progress value={job.progress} showValue />
        </div>
      )}

      {job.error && !compact && (
        <div className="mt-2.5 flex items-start gap-2 px-2.5 py-2 rounded-md bg-danger-50 border border-danger-200">
          <AlertCircle size={12} className="shrink-0 text-danger-700 mt-0.5" />
          <p className="text-[11px] text-danger-700 leading-relaxed font-medium">{job.error}</p>
        </div>
      )}

      {!compact && (job.createdAt || job.startedAt || job.endedAt) && (
        <div className="mt-2.5 pt-2 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
          {job.createdAt && (
            <span>
              Créé <span className="text-foreground">{formatTime(job.createdAt)}</span>
            </span>
          )}
          {job.startedAt && (
            <span>
              Démarré <span className="text-foreground">{formatTime(job.startedAt)}</span>
            </span>
          )}
          {job.endedAt && (
            <span>
              Fini <span className="text-foreground">{formatTime(job.endedAt)}</span>
              {job.startedAt && (
                <span className="text-muted-foreground/70 ml-1">· {formatDuration(job.startedAt, job.endedAt)}</span>
              )}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
