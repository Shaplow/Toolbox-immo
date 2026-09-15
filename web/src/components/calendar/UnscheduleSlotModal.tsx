"use client";

/**
 * UnscheduleSlotModal — remettre une publication datée dans la banque.
 *
 * Le geste inverse de « programmer » : la date part, le travail reste. Ses
 * mots : « on veut le garder de côté ». C'est un frigo, pas une poubelle —
 * d'où la distinction tenue à l'écran avec « Retirer cette vidéo », juste en
 * dessous dans le même menu, qui elle est un abandon.
 *
 * La modale existe pour DIRE ce qui se passe, parce que rien de tout cela n'est
 * devinable : que le montage survit, que les rendus en cours continuent, et que
 * le créneau libéré peut être regénéré. Trois questions que l'admin se poserait
 * après coup, sans pouvoir y répondre.
 */

import { useState } from "react";
import { Inbox } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { longDateTimeFr } from "@/lib/date/formatFr";

interface Props {
  slotId: string;
  /** Titre affiché — le label de recette ou le titre libre. */
  label: string;
  /** Date actuelle (ISO). Sert à nommer ce qu'on abandonne. */
  scheduledAt: string;
  status: string;
  onDone: () => void;
  onClose: () => void;
}

export function UnscheduleSlotModal({
  slotId,
  label,
  scheduledAt,
  status,
  onDone,
  onClose,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le lien de validation n'est pas révoqué : il porte sur le montage, pas sur
  // la date. Le taire laisserait croire qu'on vient de casser l'échange client.
  const clientLinkActive = status === "AWAITING_CLIENT";

  async function handleConfirm() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/calendar/slots/${slotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      toast.success("Remise en banque");
      onDone();
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
          Banque
        </p>
        <h2 className="mt-1 text-[18px] font-semibold text-foreground">
          Remettre « {label} » en banque ?
        </h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Elle quitte le calendrier et retourne dans la banque, sans date.
        </p>

        <ul className="mt-4 space-y-1.5 text-[12.5px] leading-relaxed text-foreground">
          <li>
            <span className="text-muted-foreground">La date du </span>
            {longDateTimeFr(scheduledAt)}
            <span className="text-muted-foreground"> est abandonnée.</span>
          </li>
          <li className="text-muted-foreground">
            <span className="text-foreground font-medium">Rien n&apos;est perdu</span> : rushs,
            montage, cover, sous-titres et description restent attachés.
          </li>
          <li className="text-muted-foreground">
            Les traitements en cours (rendu, sous-titres) continuent et reviendront dessus.
          </li>
          <li className="text-muted-foreground">
            Le créneau redevient libre — une génération de semaine pourra le reprendre.
          </li>
          {clientLinkActive && (
            <li className="text-muted-foreground">
              Le lien de validation client <span className="text-foreground">reste valide</span>.
            </li>
          )}
        </ul>

        {error && <p className="mt-3 text-[12px] text-danger-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Garder la date
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
