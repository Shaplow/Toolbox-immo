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
import { ImageIcon, AlignLeft, Loader2 } from "lucide-react";
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
   * Si coverMode="auto" mais coverPresetId null → bouton disabled avec tooltip.
   */
  resolvedConfig: {
    coverMode: string; // "auto" | "manualSelect" | "none"
    coverPresetId: string | null;
    needsCaptions: boolean;
    captionPresetId: string | null;
  };
}

export function OneOffTriggerButtons({
  slotId,
  isAdmin,
  hasCurrentVersion,
  hasNoRender,
  resolvedConfig,
}: Props) {
  const router = useRouter();
  const [coverLoading, setCoverLoading] = useState(false);
  const [captionsLoading, setCaptionsLoading] = useState(false);

  // Affichage basé sur la config RÉSOLUE (override + pattern), pas le pattern brut
  const showCoverButton = resolvedConfig.coverMode === "auto";
  const showCaptionsButton = resolvedConfig.needsCaptions === true;
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
        <p className="text-[10px] text-amber-700 mt-2">
          ⚠️ Configurez le preset manquant dans le SlotDetailPanel ou le pattern parent
          pour activer le bouton.
        </p>
      ) : null}
    </section>
  );
}
