"use client";

/**
 * CaptionsJobQueue — file d'attente des jobs de génération de captions.
 *
 * Phase F3-step5 du split de CaptionsGenerateForm (plan F3). Le bloc
 * "File de génération" était inline (~75 LOC) avec rendu d'une liste de
 * jobs (icon statut + nom + heure + bouton download + preview vidéo).
 *
 * Inclut aussi le lien "Retour à la publication" affiché après
 * soumission quand returnTo est présent et qu'au moins un job a été
 * lancé (logique cohérente avec le contexte slot publication).
 *
 * Composant pur — pas de state local, juste du rendu.
 */

import { AlertCircle, CheckCircle2, Clock, Download } from "lucide-react";

interface QueuedJob {
  id: string;
  status: string;
  videoUrl?: string;
  videoName: string;
  createdAt: Date;
}

interface Props {
  jobs: QueuedJob[];
  /** URL de retour à la publication (slot context) — affichée après le
   *  premier job soumis et hors d'un cycle busy. */
  returnTo?: string | null;
  busy: boolean;
}

export function CaptionsJobQueue({ jobs, returnTo, busy }: Props) {
  if (jobs.length === 0) return null;

  return (
    <>
      {/* Lien retour publication après soumission (Phase 1.9 A2) */}
      {returnTo && !busy && (
        <div className="text-center mt-3">
          <a
            href={returnTo}
            className="text-xs text-info-600 hover:underline"
          >
            ← Retour à la publication
          </a>
        </div>
      )}

      <div className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={14} className="text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">File de génération</p>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {jobs.length}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {jobs.map((job) => {
            const isDone = job.status === "DONE" || job.status === "COMPLETED";
            const isFailed = job.status === "FAILED";
            return (
              <div
                key={job.id}
                className="bg-white border border-border rounded-xl overflow-hidden"
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Status icon */}
                  <div className="shrink-0">
                    {isDone ? (
                      <CheckCircle2 size={16} className="text-green-500" />
                    ) : isFailed ? (
                      <AlertCircle size={16} className="text-red-400" />
                    ) : (
                      <div className="w-4 h-4 border-2 border-danger-200 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">
                      {job.videoName} · {job.createdAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className={`text-[10px] mt-0.5 ${
                      isDone ? "text-green-600" : isFailed ? "text-red-400" : "text-danger-600"
                    }`}>
                      {isDone ? "Terminé" : isFailed ? "Échec" : "En cours…"}
                    </p>
                  </div>

                  {/* Download action */}
                  {isDone && job.videoUrl && (
                    <a
                      href={job.videoUrl}
                      download
                      className="shrink-0 inline-flex items-center gap-1.5 text-xs bg-danger-600 hover:bg-danger-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                    >
                      <Download size={12} />
                      MP4
                    </a>
                  )}
                </div>

                {/* Video preview (compact) */}
                {isDone && job.videoUrl && (
                  <div className="border-t border-gray-50 p-3">
                    <div className="max-w-[280px]">
                      <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
                        <video
                          src={job.videoUrl}
                          controls
                          className="absolute inset-0 w-full h-full object-contain"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
