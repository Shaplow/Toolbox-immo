"use client";

/**
 * PlanningSection — date du tournage et équipe par défaut.
 *
 * Porte aussi la RELECTURE de la réponse du vidéaste (« disponibilité
 * confirmée », « indisponible », « en attente ») et la relance admin. Ce n'est
 * pas un doublon de `ShootAvailabilityPrompt` : celui-ci demande la réponse à
 * l'assigné, celle-ci la montre à l'admin. Deux publics, deux textes. Les deux
 * n'apparaissent ensemble que pour un admin assigné comme vidéaste — cas
 * explicitement supporté.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Select } from "@/components/ui/Select";
import { Section } from "@/components/ui/molecules/Section";
import { DateTimeField } from "@/components/ui/molecules/DateTimeField";
import { toast } from "@/components/ui/Toast";
import {
  isPastLocalInput,
  isoToLocalInput,
  localInputToIso,
  shortDateTimeFr,
} from "@/lib/date/formatFr";
import type { FicheSectionChromeProps } from "@/components/fiches/sectionShell";
import type { EntityFicheData } from "../ficheTypes";

/** Au scope module : dans le corps du composant, ce serait une TDZ en puissance. */
const assigneeOptions = (opts: { id: string; name: string }[]) => [
  { value: "", label: "— Aucun —" },
  ...opts.map((o) => ({ value: o.id, label: o.name })),
];

export interface PlanningSectionProps extends FicheSectionChromeProps {
  entity: Pick<
    EntityFicheData,
    | "id"
    | "scheduledAt"
    | "assigneeVideasteId"
    | "defaultAssigneeMonteurId"
    | "defaultAssigneeCmId"
    | "hasRushes"
    | "validationStatus"
    | "videasteConfirmation"
    | "videasteConfirmationAt"
    | "videasteDeclineReason"
  >;
  isAdmin: boolean;
  videastes: { id: string; name: string }[];
  monteurs: { id: string; name: string }[];
  cms: { id: string; name: string }[];
}

export function PlanningSection({
  entity,
  isAdmin,
  videastes,
  monteurs,
  cms,
  sectionId = "planning",
  storageKey,
  defaultOpen = true,
  collapsible = false,
}: PlanningSectionProps) {
  const router = useRouter();
  const [scheduledAt, setScheduledAt] = useState(
    entity.scheduledAt ? isoToLocalInput(entity.scheduledAt) : "",
  );
  const [assigneeVideasteId, setAssigneeVideasteId] = useState(entity.assigneeVideasteId ?? "");
  const [defaultAssigneeMonteurId, setDefaultAssigneeMonteurId] = useState(
    entity.defaultAssigneeMonteurId ?? "",
  );
  const [defaultAssigneeCmId, setDefaultAssigneeCmId] = useState(entity.defaultAssigneeCmId ?? "");
  const [planningDirty, setPlanningDirty] = useState(false);
  const [savingPlanning, setSavingPlanning] = useState(false);

  async function savePlanning() {
    setSavingPlanning(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledAt: scheduledAt ? localInputToIso(scheduledAt) : null,
          assigneeVideasteId: assigneeVideasteId || null,
          defaultAssigneeMonteurId: defaultAssigneeMonteurId || null,
          defaultAssigneeCmId: defaultAssigneeCmId || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success("Planning enregistré.");
      setPlanningDirty(false);
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setSavingPlanning(false);
    }
  }

  /**
   * ADMIN : remet la disponibilité « en attente » sans réassigner.
   *
   * Sans cette action, un refus était définitif — le vidéaste ne pouvait plus
   * répondre et l'admin n'avait que la réassignation pour débloquer, ce qui
   * perdait l'assigné d'origine.
   */
  const [resetting, setResetting] = useState(false);
  async function resetAvailability() {
    setResetting(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videasteConfirmation: null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de la relance.");
        return;
      }
      toast.success("Demande de disponibilité relancée.");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <Section
      title="Planning & équipe"
      icon={CalendarClock}
      sectionId={sectionId}
      storageKey={storageKey}
      defaultOpen={defaultOpen}
      collapsible={collapsible}
    >
      <div className="space-y-3">
        <FormField label="Date et heure">
          <>
            <DateTimeField
              value={scheduledAt}
              onChange={(v) => {
                setScheduledAt(v);
                setPlanningDirty(true);
              }}
            />
            {scheduledAt && isPastLocalInput(scheduledAt) && (
              <p className="mt-1 text-[11px] text-warning-700">
                Date passée — la fiche sort du planning de la semaine en cours.
              </p>
            )}
          </>
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField label="Vidéaste">
            <>
              <Select
                value={assigneeVideasteId}
                onChange={(v) => {
                  setAssigneeVideasteId(v);
                  setPlanningDirty(true);
                }}
                options={assigneeOptions(videastes)}
              />
              {/* La worklist du vidéaste liste les fiches qui lui sont
                  assignées : sans vidéaste, le tournage n'est nulle part. */}
              {!assigneeVideasteId && entity.hasRushes && (
                <p className="mt-1 text-[11px] text-warning-700">
                  Non assigné — ce tournage n&apos;apparaît dans la liste d&apos;aucun vidéaste.
                </p>
              )}
              {/* Réponse du vidéaste — masquée tant que la fiche attend la
                  validation admin : elle ne lui est pas encore visible. */}
              {assigneeVideasteId &&
                !planningDirty &&
                entity.validationStatus !== "PENDING_ADMIN" &&
                entity.validationStatus !== "REJECTED" &&
                (entity.videasteConfirmation === "CONFIRMED" ? (
                  <p className="mt-1 text-[11px] text-success-700">
                    Disponibilité confirmée
                    {entity.videasteConfirmationAt
                      ? ` le ${shortDateTimeFr(entity.videasteConfirmationAt)}`
                      : ""}
                    .
                  </p>
                ) : entity.videasteConfirmation === "DECLINED" ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="text-[11px] text-danger-700">
                      Indisponible
                      {entity.videasteDeclineReason ? ` — ${entity.videasteDeclineReason}` : ""}.
                    </p>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void resetAvailability()}
                        disabled={resetting}
                      >
                        Relancer la demande
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="text-[11px] text-muted-foreground">
                      En attente de confirmation du vidéaste.
                    </p>
                    {/* Relance utile seulement si une réponse a déjà été
                        donnée puis effacée : sinon la demande est déjà en
                        attente, le bouton ne ferait rien de visible. */}
                    {isAdmin && entity.videasteConfirmationAt && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void resetAvailability()}
                        disabled={resetting}
                      >
                        Relancer la demande
                      </Button>
                    )}
                  </div>
                ))}
            </>
          </FormField>
          <FormField label="Monteur par défaut">
            <Select
              value={defaultAssigneeMonteurId}
              onChange={(v) => {
                setDefaultAssigneeMonteurId(v);
                setPlanningDirty(true);
              }}
              options={assigneeOptions(monteurs)}
            />
          </FormField>
          <FormField label="CM par défaut">
            <Select
              value={defaultAssigneeCmId}
              onChange={(v) => {
                setDefaultAssigneeCmId(v);
                setPlanningDirty(true);
              }}
              options={assigneeOptions(cms)}
            />
          </FormField>
        </div>
        {planningDirty && (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void savePlanning()} disabled={savingPlanning}>
              {savingPlanning ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
