"use client";

/**
 * BulkShiftDateModal — décalage de date sur N slots.
 *
 * Phase 7 V2 — issue du split de BulkPatchModal. Deux modes :
 *   - Rapide : tous les slots → aujourd'hui+N (1j/3j/1sem/2sem).
 *   - Précis : tous les slots → la même date saisie.
 * Le backend bulk-patch n'accepte qu'une valeur unique pour `scheduledAt` —
 * un vrai décalage relatif par-slot nécessiterait N requêtes (à priori plus
 * tard).
 */

import { useState } from "react";
import { CalendarDays, ArrowRight } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { FormField } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";

interface Props {
  slotIds: string[];
  onPatched: (patchedCount: number) => void;
  onClose: () => void;
}

type Mode = "relative" | "absolute";

export function BulkShiftDateModal({ slotIds, onPatched, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("relative");
  const [relativeShiftDays, setRelativeShiftDays] = useState<number>(1);
  const [absoluteDate, setAbsoluteDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildScheduledAt(): string | null {
    if (mode === "relative") {
      const target = new Date();
      target.setDate(target.getDate() + relativeShiftDays);
      target.setHours(10, 0, 0, 0);
      return target.toISOString();
    }
    const d = new Date(`${absoluteDate}T10:00:00`);
    if (isNaN(d.getTime())) {
      setError("Date invalide");
      return null;
    }
    return d.toISOString();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const scheduledAt = buildScheduledAt();
    if (!scheduledAt) return;
    setSaving(true);
    try {
      const res = await fetch("/api/calendar/slots/bulk-patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIds, patch: { scheduledAt } }),
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
          ? `${data.patchedCount} décalée${data.patchedCount > 1 ? "s" : ""} · ${data.skippedCount} skip`
          : `${data.patchedCount} publication${data.patchedCount > 1 ? "s" : ""} décalée${data.patchedCount > 1 ? "s" : ""}`,
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
      <form onSubmit={handleSubmit} className="p-5">
        <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500 inline-flex items-center gap-1.5">
          <CalendarDays size={11} />
          Action de groupe · Décaler
        </p>
        <h2 className="mt-1 text-[18px] font-semibold text-gray-950">
          {slotIds.length} publication{slotIds.length > 1 ? "s" : ""} sélectionnée
          {slotIds.length > 1 ? "s" : ""}
        </h2>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("relative")}
            className={`px-3 py-2 rounded-lg text-[12px] font-medium transition ${
              mode === "relative"
                ? "bg-gray-900 text-white"
                : "bg-white/55 text-gray-700"
            }`}
          >
            Rapide
          </button>
          <button
            type="button"
            onClick={() => setMode("absolute")}
            className={`px-3 py-2 rounded-lg text-[12px] font-medium transition ${
              mode === "absolute"
                ? "bg-gray-900 text-white"
                : "bg-white/55 text-gray-700"
            }`}
          >
            Date précise
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {mode === "relative" ? (
            <FormField
              label="Décaler à"
              help="Toutes les publications seront repositionnées à cette date (10:00)."
            >
              <Combobox
                value={String(relativeShiftDays)}
                onChange={(v) => setRelativeShiftDays(Number(v))}
                options={[
                  { value: "1", label: "Demain" },
                  { value: "3", label: "Dans 3 jours" },
                  { value: "7", label: "Dans 1 semaine" },
                  { value: "14", label: "Dans 2 semaines" },
                ]}
              />
            </FormField>
          ) : (
            <FormField label="Date">
              <DatePicker value={absoluteDate} onChange={setAbsoluteDate} />
            </FormField>
          )}
          <p className="text-[11px] text-amber-700 bg-amber-50/70 rounded-md px-3 py-2">
            Note : tous les slots sélectionnés recevront la même date. Pour un
            décalage relatif par slot, ouvre chaque fiche.
          </p>
        </div>

        {error && <p className="mt-3 text-[12px] text-rose-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            Annuler
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            icon={ArrowRight}
            loading={saving}
          >
            Décaler
          </Button>
        </div>
      </form>
    </Modal>
  );
}
