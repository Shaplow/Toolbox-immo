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
 *
 * C'est ici que se choisit le COMPTE INSTAGRAM des publications issues d'une
 * commande : il n'est plus demandé au demandeur (« une vidéo pourrait atterrir
 * parfois sur plusieurs comptes »), donc elles arrivent en banque sans compte
 * et c'est celui qui place qui tranche. Poser le compte AVANT de programmer :
 * l'opération peut échouer (recette non active sur ce compte), et une
 * publication datée sur un compte qu'elle n'a pas serait pire que rien.
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { localInputToIso } from "@/lib/date/formatFr";
import type { PublicationSlot } from "@/types/calendar";

interface ScheduleFromBankModalProps {
  slot: PublicationSlot;
  /** Comptes proposables quand la publication n'en a pas encore. */
  accounts: { id: string; name: string; handle: string }[];
  /** Jour déjà choisi (glisser-déposer sur une colonne) — pré-rempli. */
  initialDate?: string;
  onScheduled: (slotId: string, scheduledAtIso: string) => void;
  onClose: () => void;
}

/** Heure par défaut quand on programme un slot banque — bonne valeur "vitrine". */
const DEFAULT_TIME = "10:00";

export function ScheduleFromBankModal({
  slot,
  accounts,
  initialDate,
  onScheduled,
  onClose,
}: ScheduleFromBankModalProps) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState<string>(initialDate ?? todayISO);
  const [time, setTime] = useState<string>(DEFAULT_TIME);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>("");

  // Une publication sans compte doit en recevoir un ici, pas plus tard : une
  // fois posée sur le calendrier sans compte, plus rien ne la signale.
  const needsAccount = !slot.account;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !time) {
      setError("Date et heure sont requises.");
      return;
    }
    if (needsAccount && !accountId) {
      setError("Choisissez le compte Instagram de cette publication.");
      return;
    }
    // L'heure saisie est une heure de PARIS, pas celle du navigateur.
    // `new Date("2026-09-15T10:00:00")` l'interprétait dans le fuseau local :
    // depuis un poste à +08:00, « 10:00 » atterrissait à 04:00 à Paris. Même
    // classe de bug que le publishTime du moteur hebdo, même remède.
    const scheduledAtIso = localInputToIso(`${date}T${time}`);
    if (!scheduledAtIso) {
      setError("Date ou heure invalide.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // D'abord le compte : il peut être refusé (recette non active dessus), et
      // on ne veut pas d'une publication datée sur un compte qu'elle n'a pas.
      if (needsAccount) {
        const accRes = await fetch(`/api/publications/${slot.id}/account`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId }),
        });
        if (!accRes.ok) {
          const body = (await accRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Erreur ${accRes.status}`);
        }
      }

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
          <p className="text-[11px] text-muted-foreground truncate">
            {slot.account ? `@${slot.account.handle}` : "Sans compte"}
          </p>
        </div>

        {needsAccount && (
          <div className="mt-4">
            <FormField
              label="Compte Instagram"
              required
              help="La recette et l'équipe par défaut du compte suivront."
            >
              <Select
                value={accountId}
                onChange={setAccountId}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: `${a.name} (@${a.handle})`,
                }))}
                placeholder={
                  accounts.length === 0 ? "Aucun compte disponible" : "Choisir un compte…"
                }
                disabled={accounts.length === 0}
              />
            </FormField>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <FormField label="Date">
            <DatePicker value={date} onChange={setDate} min={initialDate ?? todayISO} />
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
