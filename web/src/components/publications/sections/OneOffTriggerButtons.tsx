"use client";

/**
 * OneOffTriggerButtons — Phase 6 Cohérence Workflows.
 *
 * Boutons d'action ADMIN pour les slots one-off (pas de Render auto) afin
 * de lancer manuellement la génération cover/captions sur la PublicationVersion
 * courante (cas typique : rush externe monté + uploadé manuellement).
 *
 * Affiché uniquement si :
 *  - L'utilisateur est ADMIN
 *  - Il existe une currentVersion uploadée
 *  - Le slot n'a pas de render (== pas de cover/caption job auto déclenché)
 *
 * Côté backend :
 *  - POST /api/publications/[id]/trigger-cover
 *  - POST /api/publications/[id]/trigger-captions
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, AlignLeft, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";

interface Props {
  slotId: string;
  /** true si l'utilisateur courant est ADMIN. */
  isAdmin: boolean;
  /** true si une PublicationVersion courante existe (sinon rien à déclencher). */
  hasCurrentVersion: boolean;
  /** true si le slot n'a aucun Render lié (cas one-off). */
  hasNoRender: boolean;
  /**
   * Config résolue par resolveSlotConfig (override slot prime sur pattern).
   * coverMode/captionPresetId nuls = ne pas afficher le bouton correspondant.
   * Si coverMode="autoPack" mais coverPresetId null → bouton disabled avec tooltip.
   */
  resolvedConfig: {
    coverMode: string; // "none" | "manualSelect" | "autoPack" | "monteurUpload"
    coverPresetId: string | null;
    needsCaptions: boolean;
    captionPresetId: string | null;
  };
  /** Statut du dernier captionJob lié — masque le bouton "Lancer captions"
   *  si un job existe déjà (évite les double-clics qui créent des jobs
   *  parallèles inutiles). */
  hasCaptionJob?: boolean;
  /** Idem pour cover : pack non-FAILED déjà existant masque "Lancer cover". */
  hasCoverPack?: boolean;
}

export function OneOffTriggerButtons({
  slotId,
  isAdmin,
  hasCurrentVersion,
  hasNoRender,
  resolvedConfig,
  hasCaptionJob = false,
  hasCoverPack = false,
}: Props) {
  const router = useRouter();
  const [coverLoading, setCoverLoading] = useState(false);
  const [captionsLoading, setCaptionsLoading] = useState(false);

  // Affichage basé sur la config RÉSOLUE (override + pattern), pas le pattern brut.
  // Masquage supplémentaire : si un job (cover ou captions) a déjà été
  // déclenché, on ne re-propose pas le bouton — l'admin doit voir l'état
  // dans la section dédiée et regénérer depuis là si besoin.
  const showCoverButton = resolvedConfig.coverMode === "autoPack" && !hasCoverPack;
  const showCaptionsButton = resolvedConfig.needsCaptions === true && !hasCaptionJob;
  const coverDisabled = !resolvedConfig.coverPresetId;
  const captionsDisabled = !resolvedConfig.captionPresetId;

  // Masquer si non applicable
  if (!isAdmin || !hasCurrentVersion || !hasNoRender) return null;
  if (!showCoverButton && !showCaptionsButton) return null;

  async function trigger(action: "cover" | "captions") {
    const setLoading = action === "cover" ? setCoverLoading : setCaptionsLoading;
    setLoading(true);
    try {
      const res = await fetch(`/api/publications/${slotId}/trigger-${action}`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        message?: string;
        note?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? `Erreur lors du déclenchement ${action}`);
        return;
      }
      toast.success(
        data.message ?? (action === "cover" ? "Cover lancée" : "Captions lancées"),
      );
      if (data.note) {
        // Note transitoire pour captions (pipeline aval pas encore branché)
        setTimeout(() => toast.info(data.note!), 100);
      }
      router.refresh();
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="bg-fuchsia-50/30 border border-fuchsia-100 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-fuchsia-900">
            Slot one-off — Lancer la production manuellement
          </h3>
          <p className="text-xs text-fuchsia-700/80 mt-0.5">
            La vidéo a été uploadée manuellement (pas de render auto).
            Lance les jobs de production sur la version courante.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {showCoverButton && (
          <span title={coverDisabled ? "Aucun preset cover défini (override slot ou pattern)" : undefined}>
            <Button
              variant="secondary"
              size="sm"
              icon={coverLoading ? Loader2 : ImageIcon}
              disabled={coverLoading || coverDisabled}
              onClick={() => void trigger("cover")}
            >
              {coverLoading ? "Lancement…" : "Lancer cover auto"}
            </Button>
          </span>
        )}
        {showCaptionsButton && (
          <span title={captionsDisabled ? "Aucun preset captions défini (override slot ou pattern)" : undefined}>
            <Button
              variant="secondary"
              size="sm"
              icon={captionsLoading ? Loader2 : AlignLeft}
              disabled={captionsLoading || captionsDisabled}
              onClick={() => void trigger("captions")}
            >
              {captionsLoading ? "Lancement…" : "Lancer captions auto"}
            </Button>
          </span>
        )}
      </div>
      {(coverDisabled && showCoverButton) || (captionsDisabled && showCaptionsButton) ? (
        <p className="text-[10px] text-amber-700 mt-2 inline-flex items-center gap-1">
          <AlertTriangle size={10} className="text-amber-600 shrink-0" />
          Configurez le preset manquant dans le SlotDetailPanel ou le pattern parent
          pour activer le bouton.
        </p>
      ) : null}
    </section>
  );
}
