/**
 * CaptionsSection — section "Sous-titres" de la fiche publication.
 *
 * Phase 1.3.5 : lien vers l'outil captions dédié.
 * Phase 1.9 A2 : affichage inline de l'état du dernier CaptionJob lié au slot.
 *
 * La FK CaptionJob.slotId a été ajoutée en Phase 1.9 A2 (migration additive).
 */

import Link from "next/link";
import { Subtitles, ExternalLink, Loader2, CheckCircle, AlertCircle, Play } from "lucide-react";

interface CaptionJobInfo {
  id: string;
  status: string;
  outputUrl: string | null;
  errorMsg: string | null;
  createdAt: string;
}

interface Props {
  slot: { id: string };
  renderId: string | null;
  pattern: { needsCaptions: boolean } | null;
  /** true pour CM, MONTEUR, et ADMIN */
  canEdit: boolean;
  /** Version courante promue par l'ADMIN (si needsRushes=true). */
  currentVersion?: { versionNumber: number; fileName: string } | null;
  /** Dernier job captions lié à ce slot (Phase 1.9 A2). */
  latestCaptionJob?: CaptionJobInfo | null;
}

export function CaptionsSection({
  slot,
  renderId,
  pattern,
  canEdit,
  currentVersion,
  latestCaptionJob,
}: Props) {
  // Si le pattern n'exige pas de captions, on masque la section
  if (pattern?.needsCaptions !== true) return null;

  const captionsHref = renderId
    ? `/captions?slotId=${slot.id}&renderId=${renderId}&returnTo=/publications/${slot.id}`
    : `/captions?slotId=${slot.id}&returnTo=/publications/${slot.id}`;

  const isInProgress =
    latestCaptionJob?.status === "QUEUED" || latestCaptionJob?.status === "PROCESSING";
  const isDone = latestCaptionJob?.status === "COMPLETED";
  const isError = latestCaptionJob?.status === "FAILED";

  return (
    <section id="captions" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
      {/* En-tête section */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Subtitles size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Sous-titres</h2>
        </div>
        {currentVersion && (
          <span className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full font-medium">
            Lié à V{currentVersion.versionNumber} — {currentVersion.fileName}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {/* État du dernier job (Phase 1.9 A2) */}
        {latestCaptionJob && (
          <div className="rounded-lg border p-3 text-sm">
            {isInProgress && (
              <div className="flex items-center gap-2 text-blue-700 bg-blue-50 border-blue-200 -m-3 p-3 rounded-lg">
                <Loader2 size={15} className="animate-spin shrink-0" />
                <span>
                  {latestCaptionJob.status === "QUEUED"
                    ? "Job en file d'attente…"
                    : "Traitement en cours…"}
                </span>
              </div>
            )}
            {isDone && (
              <div className="flex items-center justify-between gap-3 text-green-700 bg-green-50 border-green-200 -m-3 p-3 rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle size={15} className="shrink-0" />
                  <span>Sous-titres générés</span>
                </div>
                {latestCaptionJob.outputUrl && (
                  <a
                    href={latestCaptionJob.outputUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-green-800 underline hover:no-underline"
                  >
                    Télécharger
                  </a>
                )}
              </div>
            )}
            {isError && (
              <div className="text-red-700 bg-red-50 border-red-200 -m-3 p-3 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle size={15} className="shrink-0" />
                  <span className="font-medium">Échec du traitement</span>
                </div>
                {latestCaptionJob.errorMsg && (
                  <p className="text-xs text-red-600 ml-5">{latestCaptionJob.errorMsg}</p>
                )}
              </div>
            )}
          </div>
        )}

        {!latestCaptionJob && (
          <p className="text-sm text-gray-500">
            Aucun job de sous-titres encore lancé pour cette publication.
          </p>
        )}

        {/* Bouton d'action vers l'outil */}
        {canEdit ? (
          <Link
            href={captionsHref}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            {isDone ? (
              <>
                <Play size={14} />
                Regénérer les sous-titres
              </>
            ) : (
              <>
                <ExternalLink size={14} />
                {latestCaptionJob ? "Gérer les sous-titres" : "Lancer les sous-titres"}
              </>
            )}
          </Link>
        ) : (
          <Link
            href={captionsHref}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors font-medium border border-indigo-200"
          >
            <ExternalLink size={14} />
            Voir les sous-titres
          </Link>
        )}
      </div>
    </section>
  );
}
