"use client";

/**
 * Réassignation groupée de fiches.
 *
 * Trois rôles, mais seulement celui du vidéaste agit sur l'existant : les deux
 * autres sont des DÉFAUTS, propagés aux publications créées ENSUITE. Les
 * proposer sans le dire laisserait croire qu'on vient de réassigner 40 montages
 * déjà en cours — d'où l'avertissement explicite.
 *
 * Un rôle laissé sur « Ne pas changer » n'est pas envoyé du tout : le serveur
 * n'écrit que les clés présentes.
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Select } from "@/components/ui/Select";

export interface BulkReassignEntitiesModalProps {
  count: number;
  videastes: { id: string; name: string }[];
  monteurs: { id: string; name: string }[];
  cms: { id: string; name: string }[];
  onApply: (assignees: {
    assigneeVideasteId?: string | null;
    defaultAssigneeMonteurId?: string | null;
    defaultAssigneeCmId?: string | null;
  }) => void;
  onClose: () => void;
  busy?: boolean;
}

/** Sentinelle « ne pas toucher à ce rôle » — distincte de « désassigner ». */
const KEEP = "__keep";
const UNASSIGN = "__unassign";

function toOptions(users: { id: string; name: string }[]) {
  return [
    { value: KEEP, label: "Ne pas changer" },
    { value: UNASSIGN, label: "Retirer l'assignation" },
    ...users.map((u) => ({ value: u.id, label: u.name })),
  ];
}

export function BulkReassignEntitiesModal({
  count,
  videastes,
  monteurs,
  cms,
  onApply,
  onClose,
  busy = false,
}: BulkReassignEntitiesModalProps) {
  const [videaste, setVideaste] = useState(KEEP);
  const [monteur, setMonteur] = useState(KEEP);
  const [cm, setCm] = useState(KEEP);

  const nothingToDo = videaste === KEEP && monteur === KEEP && cm === KEEP;

  function resolve(value: string): string | null | undefined {
    if (value === KEEP) return undefined;
    return value === UNASSIGN ? null : value;
  }

  return (
    <Modal open onClose={onClose} size="md">
      <Modal.Header onClose={onClose}>
        Réassigner {count} fiche{count > 1 ? "s" : ""}
      </Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
        <FormField label="Vidéaste">
          <Select value={videaste} onChange={setVideaste} options={toOptions(videastes)} />
        </FormField>
        <FormField label="Monteur par défaut">
          <Select value={monteur} onChange={setMonteur} options={toOptions(monteurs)} />
        </FormField>
        <FormField label="CM par défaut">
          <Select value={cm} onChange={setCm} options={toOptions(cms)} />
        </FormField>

        {(monteur !== KEEP || cm !== KEEP) && (
          <Alert variant="info">
            Le monteur et le CM sont des valeurs <strong>par défaut</strong> : elles
            s&apos;appliquent aux prochaines publications créées depuis ces fiches, pas à
            celles qui existent déjà.
          </Alert>
        )}

        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          Annuler
        </Button>
        <Button
          size="sm"
          disabled={busy || nothingToDo}
          onClick={() =>
            onApply({
              ...(resolve(videaste) !== undefined ? { assigneeVideasteId: resolve(videaste) } : {}),
              ...(resolve(monteur) !== undefined
                ? { defaultAssigneeMonteurId: resolve(monteur) }
                : {}),
              ...(resolve(cm) !== undefined ? { defaultAssigneeCmId: resolve(cm) } : {}),
            })
          }
        >
          {busy ? "Application…" : "Appliquer"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
