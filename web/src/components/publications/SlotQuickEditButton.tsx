"use client";

/**
 * SlotQuickEditButton — bouton "Édition rapide" sur la fiche publication.
 *
 * Phase polish 2026-05-30 : auparavant le SlotDetailPanel (drawer rapide) était
 * l'entry point principal depuis le calendrier. Désormais le click sur un slot
 * ouvre directement la fiche complète. Ce bouton permet de RE-ouvrir le drawer
 * d'édition rapide depuis la fiche quand on veut modifier statut/assignees/
 * overrides sans descendre dans la fiche.
 *
 * Implémentation : on fetch le slot full au click (le PublicationSlot type
 * attendu par le drawer est plus riche que ce que la fiche reçoit en props),
 * puis on monte le SlotDetailPanel. Aux callbacks onUpdated/onDeleted on
 * router.refresh() (ou redirect si delete).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { SlotDetailPanel, type SlotDetailPanelMode } from "@/components/calendar/SlotDetailPanel";
import type { PublicationSlot } from "@/types/calendar";

interface Props {
  slotId: string;
  /** Mode de scope du drawer ("admin"=full edit, "monteur"/"cm"=restreint). */
  mode?: SlotDetailPanelMode;
  /** Si fourni, redirige vers cette URL après suppression du slot. Sinon /calendar. */
  redirectAfterDelete?: string;
}

export function SlotQuickEditButton({
  slotId,
  mode = "admin",
  redirectAfterDelete = "/calendar",
}: Props) {
  const router = useRouter();
  const [slot, setSlot] = useState<PublicationSlot | null>(null);
  const [loading, setLoading] = useState(false);

  async function openDrawer() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/calendar/slots/${slotId}`);
      if (!res.ok) {
        toast.error("Impossible de charger le slot");
        return;
      }
      const data = (await res.json()) as PublicationSlot;
      setSlot(data);
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={Settings2}
        onClick={() => void openDrawer()}
        loading={loading}
        title="Édition rapide (statut, assignations, overrides)"
      >
        <span className="hidden sm:inline">Édition rapide</span>
      </Button>
      {slot && (
        <SlotDetailPanel
          key={slot.id}
          slot={slot}
          mode={mode}
          onUpdated={(updated) => {
            setSlot(updated);
            // Rafraîchit la fiche pour refléter les changements (status, assignees, etc.)
            router.refresh();
          }}
          onDeleted={() => {
            setSlot(null);
            router.push(redirectAfterDelete);
          }}
          onClose={() => setSlot(null)}
        />
      )}
    </>
  );
}
