"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2, Check, X, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/Toast";

interface Props {
  /** Render DONE dont on veut annuler l'impact rotation. */
  renderId: string;
  /** Appelé après revert réussi (en plus du router.refresh interne). */
  onReverted?: () => void;
}

type RevertSummaryResponse = {
  assets?: unknown[];
  cursors?: { reverted: boolean; skippedReason?: string }[];
  warnings?: string[];
  error?: string;
};

/**
 * Bouton admin "Annuler l'impact rotation" pour une génération standalone.
 * Appelle POST /api/admin/renders/:id/revert-usage qui décrémente les compteurs
 * d'usage et rembobine les curseurs (CAS). Confirm inline en deux temps comme
 * DeleteListingButton — pas de modale, pensé pour reverter juste après un test.
 */
export function RevertRenderButton({ renderId, onReverted }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  async function handleRevert(e: React.MouseEvent) {
    stop(e);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/renders/${renderId}/revert-usage`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as RevertSummaryResponse | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Revert impossible");
        setLoading(false);
        setConfirming(false);
        return;
      }
      const assetCount = data?.assets?.length ?? 0;
      const cursorCount = data?.cursors?.length ?? 0;
      const skipped = (data?.cursors ?? []).filter((c) => !c.reverted).length;
      const warnings = data?.warnings ?? [];
      toast.success(
        `Rotation annulée — ${assetCount} asset${assetCount > 1 ? "s" : ""}, ${cursorCount} curseur${cursorCount > 1 ? "s" : ""}`,
      );
      if (skipped > 0) {
        toast.info(
          `${skipped} curseur(s) déjà ré-avancé(s) par une génération suivante — non rembobiné(s).`,
        );
      } else if (warnings.length > 0) {
        toast.info(warnings.join(" · "));
      }
      setDone(true);
      setConfirming(false);
      setLoading(false);
      onReverted?.();
      router.refresh();
    } catch {
      toast.error("Erreur réseau lors du revert");
      setLoading(false);
      setConfirming(false);
    }
  }

  // État terminal : évite un double-revert accidentel dans la session.
  if (done) {
    return (
      <span
        title="Rotation annulée"
        aria-label="Rotation annulée"
        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-success-700"
      >
        <Check size={13} />
      </span>
    );
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-0.5">
        <button
          type="button"
          onClick={handleRevert}
          disabled={loading}
          title="Confirmer l'annulation rotation"
          aria-label="Confirmer l'annulation rotation"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-white bg-warning-600 hover:bg-warning-700 disabled:opacity-50 transition-all focus-ring"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            setConfirming(false);
          }}
          disabled={loading}
          title="Annuler"
          aria-label="Annuler"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-all focus-ring"
        >
          <X size={13} />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        stop(e);
        setConfirming(true);
      }}
      title="Annuler l'impact rotation de cette génération (admin)"
      aria-label="Annuler l'impact rotation"
      className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-warning-700 hover:bg-muted transition-all focus-ring"
    >
      <Undo2 size={13} />
    </button>
  );
}
