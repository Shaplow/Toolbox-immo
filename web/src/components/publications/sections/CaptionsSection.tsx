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

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Subtitles, ExternalLink, Loader2, CheckCircle, AlertCircle, Play, Sparkles, RefreshCw, RotateCcw } from "lucide-react";
import { canTriggerCaptions, type ActionVerdict } from "@/lib/publications/actions";
import { resolveCaptionsMode } from "@/lib/publications/captionsMode";
import { useJobEvent, useAllJobEvents } from "@/lib/hooks/jobEventBus";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Section } from "@/components/ui/molecules/Section";
import { toast } from "@/components/ui/Toast";

interface CaptionJobInfo {
  id: string;
  status: string;
  outputUrl: string | null;
  errorMsg: string | null;
  createdAt: string;
  /** V6 — Si non-null, le job est obsolète (input upstream changé) → badge UI. */
  staleSince?: string | null;
  staleReason?: string | null;
}

interface Props {
  slot: { id: string };
  renderId: string | null;
  /** Status du render principal — utilisé pour contextualiser le message
   *  "auto" (rendu en cours / fini / en échec). */
  renderStatus?: string | null;
  pattern: {
    /** "none" | "auto" | "manual". */
    needsCaptionsMode?: string | null;
    source?: string;
  } | null;
  /** true pour CM, MONTEUR, et ADMIN */
  canEdit: boolean;
  /** ADMIN strict — utilisé pour exposer le filet de sécurité "relancer la
   *  chaîne sous-titres" quand le pipeline auto a silencieusement échoué. */
  isAdmin?: boolean;
  /** Version courante promue par l'ADMIN (si needsRushes=true). */
  currentVersion?: { versionNumber: number; fileName: string } | null;
  /** Dernier job captions lié à ce slot (Phase 1.9 A2). */
  latestCaptionJob?: CaptionJobInfo | null;
  /** Statut de la transcription du montage (QUEUED/PROCESSING/COMPLETED/FAILED).
   *  Si en cours, on indique "Transcription en cours…" et on neutralise le bouton
   *  sous-titres (les segments ne sont pas encore prêts). */
  transcriptionJobStatus?: string | null;
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
  isAdmin = false,
  currentVersion,
  latestCaptionJob,
  transcriptionJobStatus,
  effectiveCaptionPresetId,
  sectionId = "captions",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: Props) {
  const router = useRouter();
  const [isRetriggering, setIsRetriggering] = useState(false);
  const [isForceRetranscribing, setIsForceRetranscribing] = useState(false);

  const callRetriggerEndpoint = async (force: boolean): Promise<void> => {
    const setLoading = force ? setIsForceRetranscribing : setIsRetriggering;
    setLoading(true);
    try {
      const url = force
        ? `/api/admin/publications/${slot.id}/retrigger-auto-captions?force=true`
        : `/api/admin/publications/${slot.id}/retrigger-auto-captions`;
      const res = await fetch(url, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        diagnostic?: string;
        before?: unknown;
        after?: unknown;
      };
      // Diagnostic complet en console pour debug — la toast peut tronquer.
      console.info("[retrigger-auto-captions] diagnostic complet :", data);
      if (!res.ok) {
        toast.error(data.error ?? data.diagnostic ?? "Impossible de relancer la chaîne sous-titres");
      } else {
        toast.success(data.diagnostic ?? data.message ?? "Pipeline sous-titres relancé");
        router.refresh();
      }
    } catch (err) {
      toast.error(`Erreur : ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRetriggerAutoCaptions = () => callRetriggerEndpoint(false);
  const handleForceRetranscribe = () => callRetriggerEndpoint(true);
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

  // V8 — visible si mode auto OU manual. resolveCaptionsMode gère le fallback Boolean.
  const captionsMode = resolveCaptionsMode({ pattern });
  if (captionsMode === "none") return null;
  const isManualMode = captionsMode === "manual";

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

  // La transcription du montage alimente l'éditeur de sous-titres. Tant qu'elle
  // tourne, les segments ne sont pas prêts : on l'indique et on neutralise le
  // bouton (sinon on tombe sur un éditeur "en cours" côté /captions/generate).
  const transcriptionInProgress =
    transcriptionJobStatus === "QUEUED" || transcriptionJobStatus === "PROCESSING";

  // Verdict centralisé : visible / enabled / intent + reason.
  // Voir lib/publications/actions.ts pour la logique métier (auto pipeline,
  // prérequis cible, job déjà en vol).
  const verdict: ActionVerdict = canTriggerCaptions({
    pattern: pattern
      ? {
          source: pattern.source ?? "auto_template",
          needsCaptionsMode: pattern.needsCaptionsMode,
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
    <span className="text-[11px] text-muted-foreground bg-card border border-border border border-white/50 px-2 py-0.5 rounded-full font-medium ">
      Lié à V{currentVersion.versionNumber}
    </span>
  ) : null;

  // Mode "manual" : même flux interactif que le standalone (transcription de la
  // vidéo montée validée → éditeur trim/highlight → burn-in), seedé par le slot.
  // On réutilise captionsHref (galerie preset → /captions/[presetId]/generate
  // ?slotId=…), comme l'auto — l'ancien éditeur SRT sidecar sans incrustation a
  // été retiré.
  if (isManualMode) {
    return (
      <Section
        title="Sous-titres"
        icon={Subtitles}
        sectionId={sectionId}
        storageKey={storageKey}
        defaultOpen={defaultOpen}
        collapsible={collapsible}
        actions={
          <span className="text-[11px] text-muted-foreground bg-card border border-border border border-white/50 px-2 py-0.5 rounded-full font-medium ">
            Mode manuel
          </span>
        }
      >
        <div className="space-y-3">
          {isDone ? (
            <Alert variant="success" icon={CheckCircle}>
              Sous-titres incrustés sur la vidéo.
            </Alert>
          ) : isInProgress ? (
            <Alert variant="info" icon={Subtitles}>
              Incrustation des sous-titres en cours…
            </Alert>
          ) : transcriptionInProgress ? (
            <Alert variant="info" icon={Loader2}>
              Transcription du montage en cours… les sous-titres seront
              disponibles juste après.
            </Alert>
          ) : (
            <Alert variant="info" icon={Subtitles}>
              Mode manuel : choisis un style, ajuste le découpage et le surlignage
              à la main sur le montage validé, puis lance l&apos;incrustation.
            </Alert>
          )}
          {canEdit && (isDone || !transcriptionInProgress) && (
            <Link href={captionsHref}>
              <Button variant="secondary" size="sm" icon={ExternalLink}>
                {isDone ? "Modifier les sous-titres" : "Écrire les sous-titres"}
              </Button>
            </Link>
          )}
        </div>
      </Section>
    );
  }

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
        {/* V6.5.1 — Badge "Obsolète" si le job est rattaché à une vidéo qui
            n'est plus la version active (promote/render replaced). L'admin doit
            relancer un caption pour avoir une version à jour. */}
        {latestCaptionJob?.staleSince && (
          <Alert variant="warning" icon={AlertCircle} title="Sous-titres obsolètes">
            Ces sous-titres ont été générés sur une version précédente de la
            vidéo. Régénère-les pour qu&apos;ils correspondent à la version
            courante.
          </Alert>
        )}

        {/* État du dernier job — Alert molecule (uniformisé pattern P4 audit V1) */}
        {latestCaptionJob && isInProgress && (
          <Alert variant="info" icon={Loader2}>
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

        {/* Transcription du montage en cours — les segments qui alimentent
            l'éditeur ne sont pas encore prêts. Prioritaire sur l'empty state. */}
        {!latestCaptionJob && transcriptionInProgress && (
          <Alert variant="info" icon={Loader2}>
            Transcription du montage en cours… les sous-titres seront disponibles
            juste après.
          </Alert>
        )}

        {/* Empty state — affiché tant qu'aucun job n'a été lancé et que le
            verdict en explique la raison (auto, waiting, etc.). */}
        {!latestCaptionJob && !transcriptionInProgress && verdict.visible && verdict.enabled === false && (
          <Alert
            variant={verdict.intent === "auto" ? "glass" : "info"}
            icon={verdict.intent === "auto" ? Sparkles : undefined}
          >
            {verdict.reason}
          </Alert>
        )}
        {!latestCaptionJob && !transcriptionInProgress && verdict.visible && verdict.enabled === true && (
          <Alert variant="info" icon={Subtitles}>
            Aucun job de sous-titres encore lancé pour cette publication.
          </Alert>
        )}

        {/* Filets de sécurité ADMIN :
             - "Relancer la chaîne" : si pipeline auto ne s'est pas
               déclenché (pas de captionJob alors qu'il devrait y en avoir).
             - "Re-transcrire" : invalide la transcription actuelle et
               relance Whisper. Utile après tuning VAD côté worker ou
               quand la transcription a un timing pollué (mots étirés).
            Le 2e bouton est plus large (visible même avec captionJob
            existant) car c'est une action de force voulue. */}
        {isAdmin && captionsMode === "auto" && renderId && renderStatus === "DONE" && (
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
            <span className="text-[11px] text-muted-foreground">Admin</span>
            <div className="flex items-center gap-2">
              {!latestCaptionJob && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={isRetriggering ? Loader2 : RefreshCw}
                  disabled={isRetriggering || isForceRetranscribing}
                  onClick={handleRetriggerAutoCaptions}
                >
                  {isRetriggering ? "Relance…" : "Relancer la chaîne"}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                icon={isForceRetranscribing ? Loader2 : RotateCcw}
                disabled={isRetriggering || isForceRetranscribing}
                onClick={handleForceRetranscribe}
                title="Invalide la transcription actuelle et relance Whisper from scratch"
              >
                {isForceRetranscribing ? "Re-transcription…" : "Re-transcrire"}
              </Button>
            </div>
          </div>
        )}

        {/* CTA actif uniquement si le verdict l'autorise — ET on garde le
            cas "Regénérer" (DONE/FAILED) qui ne dépend pas du verdict
            (l'user veut explicitement re-tenter sur la même cible). */}
        {canEdit && (((verdict.visible && verdict.enabled) && !transcriptionInProgress) || canRegenerate) && (
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
