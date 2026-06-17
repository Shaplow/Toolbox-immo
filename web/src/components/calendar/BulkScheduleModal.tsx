"use client";

/**
 * BulkScheduleModal — Sprint B.
 *
 * Programme N slots banque en une opération depuis BankView.
 * - Date de départ + heure de base
 * - Toggle « Étaler sur N jours » (cadence quotidienne)
 * - Toggle « Garder l'heure de chaque recette » (lit binding.publishTime)
 *
 * Submit → POST /api/calendar/slots/bulk-schedule.
 */

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";

interface Props {
  slotIds: string[];
  onScheduled: (scheduledCount: number) => void;
  onClose: () => void;
}

const DEFAULT_TIME = "10:00";

export function BulkScheduleModal({ slotIds, onScheduled, onClose }: Props) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState<string>(todayISO);
  const [time, setTime] = useState<string>(DEFAULT_TIME);
  const [spreadOverDays, setSpreadOverDays] = useState<number>(slotIds.length);
  const [useBindingTime, setUseBindingTime] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (slotIds.length === 0) {
      setError("Aucun slot sélectionné.");
      return;
    }
    if (!date || !time) {
      setError("Date et heure requises.");
      return;
    }
    setSaving(true);
    try {
      // Bug B.2 — on convertit date+heure locale en ISO UTC côté client
      // (même pattern qu'AddSlotModal). Évite que le serveur (souvent UTC)
      // ré-interprète "10:00" comme 10:00 UTC alors que l'admin pense local.
      const startDateTimeISO = new Date(`${date}T${time}:00`).toISOString();
      const res = await fetch("/api/calendar/slots/bulk-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotIds,
          startDateTimeISO,
          spreadOverDays: spreadOverDays > 0 ? spreadOverDays : undefined,
          useBindingTime,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const data = (await res.json()) as {
        scheduledCount: number;
        skippedCount: number;
      };
      toast.success(
        data.skippedCount > 0
          ? `${data.scheduledCount} programmés · ${data.skippedCount} ignorés (déjà datés)`
          : `${data.scheduledCount} contenus programmés`,
      );
      onScheduled(data.scheduledCount);
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
        <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-info-100 text-info-700 shrink-0">
            <CalendarClock size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
              Programmer en lot
            </p>
            <h2 className="mt-1 text-[18px] font-semibold text-foreground">
              {slotIds.length} contenu{slotIds.length > 1 ? "s" : ""} à programmer
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Choisis une date de départ. L&apos;heure peut être commune ou
              suivre celle de chaque recette.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <FormField label="Date de départ" required>
            <DatePicker value={date} onChange={setDate} min={todayISO} />
          </FormField>
          <FormField
            label="Heure de base"
            help={
              useBindingTime
                ? "Ignorée — l'heure de chaque recette prime"
                : undefined
            }
          >
            <Input
              id="bulk-time"
              type="time"
              value={time}
              onChange={(v) => setTime(v)}
              required
              disabled={useBindingTime}
            />
          </FormField>
        </div>

        <div className="mt-4 space-y-3 rounded-xl bg-card border border-border p-3 ">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={spreadOverDays > 1}
              onChange={(e) =>
                setSpreadOverDays(e.target.checked ? Math.max(2, slotIds.length) : 1)
              }
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-info-600"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-gray-900">
                Étaler sur plusieurs jours
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Programme un slot par jour à partir de la date de départ.
              </p>
              {spreadOverDays > 1 && (
                <div className="mt-2 inline-flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Sur</span>
                  <Input
                    id="spread-days"
                    type="number"
                    min={1}
                    max={slotIds.length}
                    value={String(spreadOverDays)}
                    onChange={(v) =>
                      setSpreadOverDays(
                        Math.max(1, Math.min(slotIds.length, Number(v) || 1)),
                      )
                    }
                    className="w-16"
                  />
                  <span className="text-[11px] text-muted-foreground">jours</span>
                </div>
              )}
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={useBindingTime}
              onChange={(e) => setUseBindingTime(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-info-600"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-gray-900">
                Garder l&apos;heure de chaque recette
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Utilise le publishTime du PatternBinding de chaque slot au
                lieu de l&apos;heure de base saisie au-dessus.
              </p>
            </div>
          </label>
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
            Annuler
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            icon={CalendarClock}
            loading={saving}
          >
            Programmer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
