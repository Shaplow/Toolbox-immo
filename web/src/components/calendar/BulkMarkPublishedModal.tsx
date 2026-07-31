"use client";

/**
 * BulkMarkPublishedModal — marque N slots comme publiés (status = "PUBLISHED").
 *
 * Sans lien Instagram : l'URL est propre à chaque post, un lot ne peut pas la
 * fournir. Les publications sortent signalées « lien manquant » et le lien reste
 * ajoutable depuis chaque fiche.
 *
 * Seuls les créneaux dont la vidéo est validée sont traités — les autres sont
 * ignorés côté serveur et annoncés ici AVANT validation, pour que l'admin ne
 * découvre pas le décompte après coup.
 */

import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";

interface Props {
  slotIds: string[];
  /** Nombre de créneaux sélectionnés réellement éligibles (vidéo validée). */
  eligibleCount: number;
  onPatched: (patchedCount: number) => void;
  onClose: () => void;
}

export function BulkMarkPublishedModal({ slotIds, eligibleCount, onPatched, onClose }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ignoredCount = slotIds.length - eligibleCount;

  async function handleConfirm() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/calendar/slots/bulk-mark-published", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIds }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const data = (await res.json()) as {
        patchedCount: number;
        skippedCount: number;
      };
      const plural = data.patchedCount > 1 ? "s" : "";
      toast.success(
        data.skippedCount > 0
          ? `${data.patchedCount} publiée${plural} · ${data.skippedCount} ignorée${data.skippedCount > 1 ? "s" : ""}`
          : `${data.patchedCount} publication${plural} marquée${plural} publiée${plural}`,
      );
      onPatched(data.patchedCount);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="md">
      <div className="p-5">
        <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground inline-flex items-center gap-1.5">
          <CheckCircle size={11} />
          Action de groupe · Marquer publié
        </p>
        <h2 className="mt-1 text-[18px] font-semibold text-foreground">
          Marquer {eligibleCount} publication{eligibleCount > 1 ? "s" : ""} comme publiée
          {eligibleCount > 1 ? "s" : ""} ?
        </h2>

        <div className="mt-4 p-3 rounded-lg bg-muted text-[12.5px] text-muted-foreground leading-relaxed">
          Le lien Instagram n&apos;est pas demandé ici — il est propre à chaque post.
          Les publications seront signalées « lien manquant » et tu pourras
          l&apos;ajouter depuis chaque fiche.
        </div>

        {ignoredCount > 0 && (
          <div className="mt-3 p-3 rounded-lg bg-warning-50 text-[12.5px] text-warning-700 leading-relaxed">
            {ignoredCount} créneau{ignoredCount > 1 ? "x" : ""} sélectionné
            {ignoredCount > 1 ? "s" : ""} ser{ignoredCount > 1 ? "ont" : "a"} ignoré
            {ignoredCount > 1 ? "s" : ""} : vidéo pas encore validée, ou aucun compte
            Instagram assigné.
          </div>
        )}

        {error && <p className="mt-3 text-[12px] text-danger-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button
            type="button"
            size="sm"
            icon={CheckCircle}
            onClick={handleConfirm}
            loading={saving}
            disabled={eligibleCount === 0}
          >
            Marquer publié
          </Button>
        </div>
      </div>
    </Modal>
  );
}
