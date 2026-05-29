"use client";

/**
 * JobQueueItem — item de liste de jobs (render, captions, autocut,
 * description, transcription).
 *
 * Factorise les patterns dupliqués dans :
 * - RenderSection (jobs render en cours)
 * - CaptionsJobQueue
 * - DescriptionJob list
 * - jobs/page (toutes catégories)
 * - MediaAutocutJob review queue
 *
 * Doctrine Liquid Glass v2 :
 * - Card glass-soft + ring inset signature.
 * - Tinted légèrement selon status (sky in_progress, sage done, rose failed).
 * - Hover lift + ring inset renforcé.
 * - Layout :
 *   - Top : StatusBadge (avec spin) + title semibold + actions à droite
 *   - Description gray sous-titre
 *   - Progress bar inline si progress défini
 *   - Bottom : timestamps tabular + error rouge si présent
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
  /** Si défini, affiche une barre de progression. 0-100. */
  progress?: number;
  createdAt?: Date | string;
  startedAt?: Date | string;
  endedAt?: Date | string;
  error?: string;
}

interface JobQueueItemProps {
  job: JobMeta;
  /** Actions à droite (Button retry, Button cancel, ButtonIcon view…). */
  actions?: ReactNode;
  /** Click row → ouvre détail du job. */
  onClick?: () => void;
  /** Variant compact (h-12 row sans description). Default false. */
  compact?: boolean;
  className?: string;
}

const STATUS_TINT: Record<string, string> = {
  IN_PROGRESS: "bg-sky-50/45",
  GENERATING:  "bg-sky-50/45",
  RUNNING:     "bg-sky-50/45",
  RENDERING:   "bg-sky-50/45",
  UPLOADING:   "bg-sky-50/45",
  COMPLETED:   "bg-sage-50/40",
  READY:       "bg-sage-50/40",
  DONE:        "bg-sage-50/40",
  FAILED:      "bg-rose-50/40",
  ERROR:       "bg-rose-50/40",
};

function formatTime(d?: Date | string): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(date.getTime())) return "—";
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
  const tintCls = STATUS_TINT[job.status] ?? "bg-white/40";
  const interactive = !!onClick;

  return (
    <article
      onClick={interactive ? onClick : undefined}
      className={[
        "rounded-xl px-4 py-3 transition-all backdrop-blur-[10px] backdrop-saturate-150",
        tintCls,
        "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.08),inset_0_-1px_0_rgba(15,23,42,0.04)]",
        interactive
          ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.14),0_4px_16px_-4px_rgba(15,23,42,0.12)]"
          : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {/* Top row : StatusBadge + title + actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge domain={job.domain} status={job.status} size="sm" />
            <p className="text-[13px] font-semibold text-gray-950 truncate leading-tight">
              {job.title}
            </p>
          </div>
          {job.description && !compact && (
            <p className="text-[12px] text-gray-600 leading-relaxed">
              {job.description}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0 flex items-center gap-1.5">{actions}</div>}
      </div>

      {/* Progress bar inline */}
      {job.progress !== undefined && !compact && (
        <div className="mt-2.5">
          <Progress
            value={job.progress}
            accent={
              job.status === "FAILED" || job.status === "ERROR" ? undefined
              : job.status === "COMPLETED" || job.status === "DONE" || job.status === "READY" ? "sage"
              : "sky"
            }
            showValue
          />
        </div>
      )}

      {/* Error block */}
      {job.error && !compact && (
        <div className="mt-2.5 flex items-start gap-2 px-2.5 py-2 rounded-md bg-rose-50/55 backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(201,113,133,0.14)]">
          <AlertCircle size={12} className="shrink-0 text-rose-700 mt-0.5" />
          <p className="text-[11px] text-rose-700 leading-relaxed font-medium">{job.error}</p>
        </div>
      )}

      {/* Bottom row : timestamps */}
      {!compact && (job.createdAt || job.startedAt || job.endedAt) && (
        <div className="mt-2.5 pt-2 border-t border-white/40 flex items-center justify-between text-[10px] text-gray-500 tabular-nums">
          {job.createdAt && (
            <span>
              Créé <span className="text-gray-700">{formatTime(job.createdAt)}</span>
            </span>
          )}
          {job.startedAt && (
            <span>
              Démarré <span className="text-gray-700">{formatTime(job.startedAt)}</span>
            </span>
          )}
          {job.endedAt && (
            <span>
              Fini <span className="text-gray-700">{formatTime(job.endedAt)}</span>
              {job.startedAt && (
                <span className="text-gray-400 ml-1">· {formatDuration(job.startedAt, job.endedAt)}</span>
              )}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
