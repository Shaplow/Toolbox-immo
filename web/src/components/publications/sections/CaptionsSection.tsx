/**
 * CaptionsSection — section "Sous-titres" de la fiche publication.
 *
 * Phase 1.3.5 : lien vers l'outil captions dédié.
 * Phase 1.9 A2 : affichage inline de l'état du dernier CaptionJob lié au slot.
 * Phase 6.2 : polling SSE — refresh auto quand le webhook RunPod termine.
 *
 * La FK CaptionJob.slotId a été ajoutée en Phase 1.9 A2 (migration additive).
 */

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Subtitles, ExternalLink, Loader2, CheckCircle, AlertCircle, Play, Sparkles } from "lucide-react";
import { canTriggerCaptions, type ActionVerdict } from "@/lib/publications/actions";
import { useJobEvent, useAllJobEvents } from "@/lib/hooks/jobEventBus";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Section } from "@/components/ui/molecules/Section";

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
  /** Status du render principal — utilisé pour contextualiser le message
   *  "auto" (rendu en cours / fini / en échec). */
  renderStatus?: string | null;
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
  sectionId?: string;
  storageKey?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
}

export function CaptionsSection({
  slot,
  renderId,
  renderStatus,
  pattern,
  canEdit,
  currentVersion,
  latestCaptionJob,
  effectiveCaptionPresetId,
  sectionId = "captions",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: Props) {
  const router = useRouter();
  // Polling SSE — refresh auto quand le webhook RunPod marque le job
  // captions COMPLETED/FAILED. Sans ça, l'utilisateur reste bloqué sur
  // "Traitement en cours…" jusqu'à un F5 manuel.
  const jobId = latestCaptionJob?.id ?? null;
  const jobStatus = latestCaptionJob?.status ?? null;
  const jobEvent = useJobEvent(jobId ?? "");
  useEffect(() => {
    if (!jobEvent || !jobStatus) return;
    if (jobEvent.status !== jobStatus) router.refresh();
  }, [jobEvent, jobStatus, router]);
  // Si on n'a PAS encore de captionJob (pipeline auto pas encore déclenché)
  // mais qu'un job captions arrive en SSE, on rafraîchit pour récupérer son
  // état. Sinon l'user reste bloqué sur "Sous-titres en cours…" jusqu'à F5.
  useAllJobEvents((evt) => {
    if (evt.jobType !== "captions") return;
    if (!jobId) router.refresh();
  });

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
    // Fix 2026-05-30 : on passe le vrai status du render (au lieu de "DONE" en
    // dur), pour que le verdict puisse afficher un message contextualisé selon
    // l'étape : rendu en cours, fini, ou en échec.
    render: renderId ? { status: renderStatus ?? "DONE" } : null,
    currentVersion: currentVersion ? { id: "v" } : null,
    coverPack: null,
    latestCaptionJob: latestCaptionJob ?? null,
    isAdmin: canEdit,
    canEdit,
  });
  // Regénérer reste possible après un job final (DONE ou FAILED).
  const canRegenerate = isDone || isError;

  const linkedBadge = currentVersion ? (
    <span className="text-[11px] text-gray-600 bg-white/60 backdrop-blur-[6px] border border-white/50 px-2 py-0.5 rounded-full font-medium shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06)]">
      Lié à V{currentVersion.versionNumber}
    </span>
  ) : null;

  return (
    <Section
      title="Sous-titres"
      icon={Subtitles}
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
      actions={linkedBadge}
    >

      <div className="space-y-3">
        {/* État du dernier job — Alert molecule (uniformisé pattern P4 audit V1) */}
        {latestCaptionJob && isInProgress && (
          <Alert variant="glass" icon={Loader2}>
            {latestCaptionJob.status === "QUEUED"
              ? "Job en file d'attente…"
              : "Traitement en cours…"}
          </Alert>
        )}
        {latestCaptionJob && isDone && (
          <Alert
            variant="success"
            icon={CheckCircle}
            actions={
              latestCaptionJob.outputUrl ? (
                <a
                  href={latestCaptionJob.outputUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-success-700 underline hover:no-underline font-medium"
                >
                  Télécharger
                </a>
              ) : undefined
            }
          >
            Sous-titres générés
          </Alert>
        )}
        {latestCaptionJob && isError && (
          <Alert variant="danger" icon={AlertCircle} title="Échec du traitement">
            {latestCaptionJob.errorMsg ?? null}
          </Alert>
        )}

        {/* Empty state — affiché tant qu'aucun job n'a été lancé et que le
            verdict en explique la raison (auto, waiting, etc.). */}
        {!latestCaptionJob && verdict.visible && verdict.enabled === false && (
          <Alert
            variant={verdict.intent === "auto" ? "glass" : "info"}
            icon={verdict.intent === "auto" ? Sparkles : undefined}
          >
            {verdict.reason}
          </Alert>
        )}
        {!latestCaptionJob && verdict.visible && verdict.enabled === true && (
          <Alert variant="glass" icon={Subtitles}>
            Aucun job de sous-titres encore lancé pour cette publication.
          </Alert>
        )}

        {/* CTA actif uniquement si le verdict l'autorise — ET on garde le
            cas "Regénérer" (DONE/FAILED) qui ne dépend pas du verdict
            (l'user veut explicitement re-tenter sur la même cible). */}
        {canEdit && ((verdict.visible && verdict.enabled) || canRegenerate) && (
          <Link href={captionsHref}>
            <Button variant="secondary" size="sm" icon={canRegenerate ? Play : ExternalLink}>
              {canRegenerate
                ? "Regénérer les sous-titres"
                : latestCaptionJob
                  ? "Gérer les sous-titres"
                  : "Lancer les sous-titres"}
            </Button>
          </Link>
        )}

        {/* Lecture seule (rôles non-éditeurs) : lien vers l'outil si un job existe. */}
        {!canEdit && latestCaptionJob && (
          <Link href={captionsHref}>
            <Button variant="ghost" size="sm" icon={ExternalLink}>
              Voir les sous-titres
            </Button>
          </Link>
        )}
      </div>
    </Section>
  );
}
