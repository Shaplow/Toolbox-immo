"use client";

/**
 * BulkCancelModal — annulation en masse sur N slots (status = "CANCELLED").
 *
 * Phase 7 V2 — issue du split de BulkPatchModal. Action destructive, donc
 * ConfirmDialog-style avec liste explicite des slots impactés.
 */

import { useState } from "react";
import { Ban } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";

interface Props {
  slotIds: string[];
  onPatched: (patchedCount: number) => void;
  onClose: () => void;
}

export function BulkCancelModal({ slotIds, onPatched, onClose }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/calendar/slots/bulk-patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIds, patch: { status: "CANCELLED" } }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const data = (await res.json()) as {
        patchedCount: number;
        skippedCount: number;
      };
      toast.success(
        data.skippedCount > 0
          ? `${data.patchedCount} annulée${data.patchedCount > 1 ? "s" : ""} · ${data.skippedCount} skip`
          : `${data.patchedCount} publication${data.patchedCount > 1 ? "s" : ""} annulée${data.patchedCount > 1 ? "s" : ""}`,
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
          <Ban size={11} />
          Action de groupe · Annuler
        </p>
        <h2 className="mt-1 text-[18px] font-semibold text-foreground">
          Annuler {slotIds.length} publication{slotIds.length > 1 ? "s" : ""} ?
        </h2>

        <div className="mt-4 p-3 rounded-lg bg-danger-50/60 text-[12.5px] text-danger-700 leading-relaxed">
          Les {slotIds.length} publication{slotIds.length > 1 ? "s" : ""} sélectionnée
          {slotIds.length > 1 ? "s" : ""} passe{slotIds.length > 1 ? "nt" : ""} en
          statut « Annulée ». Cette action n&apos;est pas réversible via cette
          modale (elle reste disponible via l&apos;API ou la fiche individuelle).
        </div>

        {error && <p className="mt-3 text-[12px] text-danger-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            Garder
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            icon={Ban}
            onClick={handleConfirm}
            loading={saving}
          >
            Annuler les publications
          </Button>
        </div>
      </div>
    </Modal>
  );
}
