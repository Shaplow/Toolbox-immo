/**
 * CaptionsSection — section "Sous-titres" de la fiche publication.
 *
 * Phase 1.3.5 : lien vers l'outil captions dédié.
 * Phase 1.9 A2 : affichage inline de l'état du dernier CaptionJob lié au slot.
 *
 * La FK CaptionJob.slotId a été ajoutée en Phase 1.9 A2 (migration additive).
 */

import Link from "next/link";
import { Subtitles, ExternalLink, Loader2, CheckCircle, AlertCircle, Play, Sparkles } from "lucide-react";
import { canTriggerCaptions, type ActionVerdict } from "@/lib/publications/actions";

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
  pattern: { needsCaptions: boolean; source?: string } | null;
  /** true pour CM, MONTEUR, et ADMIN */
  canEdit: boolean;
  /** Version courante promue par l'ADMIN (si needsRushes=true). */
  currentVersion?: { versionNumber: number; fileName: string } | null;
  /** Dernier job captions lié à ce slot (Phase 1.9 A2). */
  latestCaptionJob?: CaptionJobInfo | null;
  /** Preset captions effectif (override slot ou pattern). Si défini, le
   *  lien "Avancé" pointe direct vers /captions/[presetId]/generate, sinon
   *  vers la gallery /captions où l'user doit choisir. */
  effectiveCaptionPresetId?: string | null;
}

export function CaptionsSection({
  slot,
  renderId,
  pattern,
  canEdit,
  currentVersion,
  latestCaptionJob,
  effectiveCaptionPresetId,
}: Props) {
  // Si le pattern n'exige pas de captions, on masque la section
  if (pattern?.needsCaptions !== true) return null;

  // renderId n'est pas consommé par /captions ni /descriptions (audit nav
  // 2026-05-28) — on l'omet pour ne pas laisser un param fantôme dans l'URL.
  // Si on connaît déjà le preset effectif, on saute l'étape gallery.
  const captionsHref = effectiveCaptionPresetId
    ? `/captions/${effectiveCaptionPresetId}/generate?slotId=${slot.id}&returnTo=/publications/${slot.id}`
    : `/captions?slotId=${slot.id}&returnTo=/publications/${slot.id}`;

  const isInProgress =
    latestCaptionJob?.status === "QUEUED" || latestCaptionJob?.status === "PROCESSING";
  const isDone = latestCaptionJob?.status === "COMPLETED";
  const isError = latestCaptionJob?.status === "FAILED";

  // Verdict centralisé : visible / enabled / intent + reason.
  // Voir lib/publications/actions.ts pour la logique métier (auto pipeline,
  // prérequis cible, job déjà en vol).
  const verdict: ActionVerdict = canTriggerCaptions({
    pattern: pattern
      ? {
          source: pattern.source ?? "auto_template",
          needsCaptions: pattern.needsCaptions,
          needsDescription: "none",
          coverMode: "none",
        }
      : null,
    resolved: null,
    render: renderId ? { status: "DONE" } : null,
    currentVersion: currentVersion ? { id: "v" } : null,
    coverPack: null,
    latestCaptionJob: latestCaptionJob ?? null,
    isAdmin: canEdit,
    canEdit,
  });
  // Regénérer reste possible après un job final (DONE ou FAILED).
  const canRegenerate = isDone || isError;

  return (
    <section id="captions" className="bg-white border border-gray-100 rounded-2xl p-8">
      {/* En-tête section */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Subtitles size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Sous-titres</h2>
        </div>
        {currentVersion && (
          <span className="text-xs text-gray-600 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full font-medium">
            Lié à V{currentVersion.versionNumber} — {currentVersion.fileName}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {/* État du dernier job (Phase 1.9 A2) */}
        {latestCaptionJob && (
          <div className="rounded-lg border p-3 text-sm">
            {isInProgress && (
              <div className="flex items-center gap-2 text-gray-700 bg-gray-50 border-gray-200 -m-3 p-3 rounded-lg">
                <Loader2 size={15} className="animate-spin shrink-0" />
                <span>
                  {latestCaptionJob.status === "QUEUED"
                    ? "Job en file d'attente…"
                    : "Traitement en cours…"}
                </span>
              </div>
            )}
            {isDone && (
              <div className="flex items-center justify-between gap-3 text-success-700 bg-success-50 border-success-200 -m-3 p-3 rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle size={15} className="shrink-0" />
                  <span>Sous-titres générés</span>
                </div>
                {latestCaptionJob.outputUrl && (
                  <a
                    href={latestCaptionJob.outputUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-success-700 underline hover:no-underline"
                  >
                    Télécharger
                  </a>
                )}
              </div>
            )}
            {isError && (
              <div className="text-danger-700 bg-danger-50 border-danger-200 -m-3 p-3 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle size={15} className="shrink-0" />
                  <span className="font-medium">Échec du traitement</span>
                </div>
                {latestCaptionJob.errorMsg && (
                  <p className="text-xs text-danger-700/80 ml-5">{latestCaptionJob.errorMsg}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Empty state — affiché tant qu'aucun job n'a été lancé et que le
            verdict en explique la raison (auto, waiting, etc.). */}
        {!latestCaptionJob && verdict.visible && verdict.enabled === false && (
          <div className="flex items-start gap-2 text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
            {verdict.intent === "auto" && (
              <Sparkles size={14} className="text-gray-500 shrink-0 mt-0.5" />
            )}
            <span>{verdict.reason}</span>
          </div>
        )}
        {!latestCaptionJob && verdict.visible && verdict.enabled === true && (
          <p className="text-sm text-gray-500">
            Aucun job de sous-titres encore lancé pour cette publication.
          </p>
        )}

        {/* CTA actif uniquement si le verdict l'autorise — ET on garde le
            cas "Regénérer" (DONE/FAILED) qui ne dépend pas du verdict
            (l'user veut explicitement re-tenter sur la même cible). */}
        {canEdit && ((verdict.visible && verdict.enabled) || canRegenerate) && (
          <Link
            href={captionsHref}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            {canRegenerate ? (
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
        )}

        {/* Lecture seule (rôles non-éditeurs) : lien vers l'outil si un job existe. */}
        {!canEdit && latestCaptionJob && (
          <Link
            href={captionsHref}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors font-medium"
          >
            <ExternalLink size={14} />
            Voir les sous-titres
          </Link>
        )}
      </div>
    </section>
  );
}
