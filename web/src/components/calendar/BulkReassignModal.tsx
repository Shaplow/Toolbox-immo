"use client";

/**
 * BulkReassignModal — réassignation monteur/CM/vidéaste sur N slots.
 *
 * Phase 7 V2 — issue du split de BulkPatchModal (multi-actions monolithique)
 * en 3 modales focalisées. Le contrat API est inchangé :
 *   POST /api/calendar/slots/bulk-patch { slotIds, patch }.
 */

import { useState } from "react";
import { UserCheck, ArrowRight } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { FormField } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";

interface AssigneeOption {
  id: string;
  label: string;
}

interface Props {
  slotIds: string[];
  monteurs: AssigneeOption[];
  cms: AssigneeOption[];
  videastes: AssigneeOption[];
  onPatched: (patchedCount: number) => void;
  onClose: () => void;
}

type Role = "monteur" | "cm" | "videaste";

const FIELD_BY_ROLE: Record<Role, string> = {
  monteur: "assigneeMonteurId",
  cm: "assigneeCmId",
  videaste: "assigneeVideasteId",
};

export function BulkReassignModal({
  slotIds,
  monteurs,
  cms,
  videastes,
  onPatched,
  onClose,
}: Props) {
  const [role, setRole] = useState<Role>("monteur");
  const [assigneeId, setAssigneeId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assignees = role === "monteur" ? monteurs : role === "cm" ? cms : videastes;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const patch = { [FIELD_BY_ROLE[role]]: assigneeId || null };
    setSaving(true);
    try {
      const res = await fetch("/api/calendar/slots/bulk-patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIds, patch }),
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
          ? `${data.patchedCount} réassignée${data.patchedCount > 1 ? "s" : ""} · ${data.skippedCount} skip`
          : `${data.patchedCount} publication${data.patchedCount > 1 ? "s" : ""} réassignée${data.patchedCount > 1 ? "s" : ""}`,
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
        <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground inline-flex items-center gap-1.5">
          <UserCheck size={11} />
          Action de groupe · Réassignation
        </p>
        <h2 className="mt-1 text-[18px] font-semibold text-foreground">
          {slotIds.length} publication{slotIds.length > 1 ? "s" : ""} sélectionnée
          {slotIds.length > 1 ? "s" : ""}
        </h2>

        <div className="mt-4 space-y-3">
          <FormField label="Rôle">
            <Combobox
              value={role}
              onChange={(v) => {
                setRole(v as Role);
                setAssigneeId("");
              }}
              options={[
                { value: "monteur", label: "Monteur" },
                { value: "cm", label: "Community manager" },
                { value: "videaste", label: "Vidéaste" },
              ]}
            />
          </FormField>
          <FormField
            label={`Nouveau ${role}`}
            help="Laisse vide pour retirer l'assignation."
          >
            <Combobox
              value={assigneeId}
              onChange={setAssigneeId}
              options={[
                { value: "", label: "— Retirer l'assignation —" },
                ...assignees.map((a) => ({ value: a.id, label: a.label })),
              ]}
            />
          </FormField>
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
            icon={ArrowRight}
            loading={saving}
          >
            Réassigner
          </Button>
        </div>
      </form>
    </Modal>
  );
}
