"use client";

/**
 * ActivitySection — le fil d'activité de la fiche.
 *
 * Composant pur : aucun état, aucune action, les 50 derniers événements
 * arrivent en props depuis la page.
 *
 * Reste visible de TOUS les rôles, alors que son équivalent sur la publication
 * est réservé à l'admin. La divergence est réelle et connue ; l'aligner serait
 * un changement de politique, pas un refactor.
 */

import { History } from "lucide-react";
import { Section } from "@/components/ui/molecules/Section";
import { shortDateTimeFr } from "@/lib/date/formatFr";
import type { FicheSectionChromeProps } from "@/components/fiches/sectionShell";
import type { EntityActivityItem } from "../ficheTypes";

const ACTIVITY_LABELS: Record<string, string> = {
  CREATED: "Fiche créée",
  UPDATED: "Fiche modifiée",
  STATUS_CHANGED: "Statut changé",
  RUSHES_UPLOADED: "Rush ajouté",
  RUSHES_DELETED: "Rush supprimé",
  SHOT: "Marquée réalisée",
  // Le même événement couvre les deux chemins (reel sur un tournage, missions
  // sur une fiche data) — d'où un libellé qui vaut pour les deux.
  SLOT_ATTACHED: "Publication rattachée",
  CANCELLED: "Fiche annulée",
  DONE: "Fiche terminée",
  VALIDATION_APPROVED: "Fiche validée",
  VALIDATION_REJECTED: "Fiche refusée",
  VALIDATION_REQUESTED: "Validation client demandée",
  VIDEASTE_CONFIRMED: "Disponibilité confirmée",
  VIDEASTE_DECLINED: "Vidéaste indisponible",
  VIDEASTE_RESET: "Disponibilité relancée",
};

export interface ActivitySectionProps extends FicheSectionChromeProps {
  activities: EntityActivityItem[];
}

export function ActivitySection({
  activities,
  sectionId = "activity",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: ActivitySectionProps) {
  return (
    <Section
      title="Activité"
      icon={History}
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
    >
      <ul className="space-y-2">
        {activities.map((a) => (
          // Empilé plutôt qu'en ligne : la colonne de droite fait 320px, et une
          // seule ligne y renvoie l'acteur et la date à la ligne n'importe où.
          <li key={a.id} className="text-[12px]">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-border shrink-0" />
              <span className="text-foreground">{ACTIVITY_LABELS[a.type] ?? a.type}</span>
            </span>
            <span className="block pl-3.5 text-[11px] text-muted-foreground tabular-nums">
              {a.actorName ? `${a.actorName} · ` : ""}
              {shortDateTimeFr(a.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
