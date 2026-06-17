"use client";

/**
 * ScheduleFromBankModal — sortie de banque vers calendrier.
 *
 * P1 : version compacte (size sm + UI épurée) qui se rapproche d'un popover.
 * Permet la saisie rapide date+heure sans encombrer l'écran d'une modale
 * full screen. Distincte du SlotDetailPanel:Configuration qui sert à
 * l'orchestration complète (assignations, overrides, planning).
 *
 * Le serveur émet automatiquement une activité BANK_SLOT_SCHEDULED en plus
 * de la mise à jour normale.
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import type { PublicationSlot } from "@/types/calendar";

interface ScheduleFromBankModalProps {
  slot: PublicationSlot;
  onScheduled: (slotId: string, scheduledAtIso: string) => void;
  onClose: () => void;
}

/** Heure par défaut quand on programme un slot banque — bonne valeur "vitrine". */
const DEFAULT_TIME = "10:00";

export function ScheduleFromBankModal({
  slot,
  onScheduled,
  onClose,
}: ScheduleFromBankModalProps) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState<string>(todayISO);
  const [time, setTime] = useState<string>(DEFAULT_TIME);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !time) {
      setError("Date et heure sont requises.");
      return;
    }
    const parsed = new Date(`${date}T${time}:00`);
    if (isNaN(parsed.getTime())) {
      setError("Date ou heure invalide.");
      return;
    }
    const scheduledAtIso = parsed.toISOString();

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/calendar/slots/${slot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: scheduledAtIso }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      toast.success("Publication programmée");
      onScheduled(slot.id, scheduledAtIso);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la programmation");
    } finally {
      setSaving(false);
    }
  }

  const title = slot.pattern?.label ?? slot.title ?? "Publication";

  return (
    <Modal open onClose={onClose} size="sm">
      <form onSubmit={handleSubmit} className="p-5">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
            Programmer
          </p>
          <h2 className="mt-0.5 text-[15px] font-semibold text-foreground truncate leading-tight">
            {title}
          </h2>
          <p className="text-[11px] text-muted-foreground truncate">@{slot.account.handle}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <FormField label="Date">
            <DatePicker value={date} onChange={setDate} min={todayISO} />
          </FormField>
          <FormField label="Heure">
            <Input
              id="bank-time"
              type="time"
              value={time}
              onChange={(v) => setTime(v)}
              required
            />
          </FormField>
        </div>

        {error && <p className="mt-2 text-[11.5px] text-danger-700">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            Annuler
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            Programmer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
