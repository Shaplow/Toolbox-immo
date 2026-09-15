"use client";

/**
 * BulkUnscheduleModal — remettre N publications en banque d'un coup.
 *
 * Même geste que `UnscheduleSlotModal`, en lot. Le serveur accepte déjà
 * `bulk-patch { scheduledAt: null }` ; il écarte au passage les publiées et les
 * terminées sans faire échouer le reste, d'où l'annonce des refus : une
 * sélection à la souris en attrape presque toujours une.
 */

import { useState } from "react";
import { Inbox } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";

interface Props {
  slotIds: string[];
  onPatched: (patchedCount: number) => void;
  onClose: () => void;
}

export function BulkUnscheduleModal({ slotIds, onPatched, onClose }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plural = slotIds.length > 1;

  async function handleConfirm() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/calendar/slots/bulk-patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIds, patch: { scheduledAt: null } }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const data = (await res.json()) as {
        patchedCount: number;
        skippedCount: number;
      };
      const n = data.patchedCount;
      toast.success(
        data.skippedCount > 0
          ? `${n} remise${n > 1 ? "s" : ""} en banque · ${data.skippedCount} ignorée${data.skippedCount > 1 ? "s" : ""} (publiées ou terminées)`
          : `${n} publication${n > 1 ? "s" : ""} remise${n > 1 ? "s" : ""} en banque`,
      );
      onPatched(data.patchedCount);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="md">
      <div className="p-5">
        <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground inline-flex items-center gap-1.5">
          <Inbox size={11} />
          Action de groupe · Banque
        </p>
        <h2 className="mt-1 text-[18px] font-semibold text-foreground">
          Remettre {slotIds.length} publication{plural ? "s" : ""} en banque ?
        </h2>

        <ul className="mt-4 space-y-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
          <li>
            Elle{plural ? "s" : ""} quitte{plural ? "nt" : ""} le calendrier et perde
            {plural ? "nt" : ""} leur date.
          </li>
          <li>
            <span className="text-foreground font-medium">Rien n&apos;est perdu</span> : rushs,
            montage, cover, sous-titres et description restent attachés.
          </li>
          <li>
            Les créneaux redeviennent libres — une génération de semaine pourra les reprendre.
          </li>
          <li>
            Les publications déjà publiées ou terminées sont ignorées : leur date est un fait.
          </li>
        </ul>

        {error && <p className="mt-3 text-[12px] text-danger-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Garder les dates
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={Inbox}
            onClick={handleConfirm}
            loading={saving}
          >
            Remettre en banque
          </Button>
        </div>
      </div>
    </Modal>
  );
}
