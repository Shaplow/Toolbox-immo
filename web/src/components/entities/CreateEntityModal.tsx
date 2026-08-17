"use client";

import { DateTimeField } from "@/components/ui/molecules/DateTimeField";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Combobox } from "@/components/ui/Combobox";
import { Select } from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { CustomFieldValueInput } from "@/components/fields/CustomFieldValueInput";
import type { EntityTypeSummary } from "@/types/entities";

interface Option {
  id: string;
  name: string;
}

export interface CreateEntityModalProps {
  open: boolean;
  onClose: () => void;
  type: EntityTypeSummary;
  accounts: { id: string; name: string; handle: string }[];
  videastes: Option[];
  monteurs: Option[];
  cms: Option[];
}

const NONE = "";

/**
 * CreateEntityModal — création d'une fiche (Entity) générique, port fusionné
 * de CreateEventModal (« Tournage »). Les champs affichés dépendent des
 * capacités du type (hasAccount/hasPlanning/hasAssignees) + de son
 * fieldSchema (champs custom, saisis via CustomFieldValueInput).
 */
export function CreateEntityModal({
  open,
  onClose,
  type,
  accounts,
  videastes,
  monteurs,
  cms,
}: CreateEntityModalProps) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [accountId, setAccountId] = useState(NONE);
  const [relatedEntityId, setRelatedEntityId] = useState(NONE);
  const [scheduledAt, setScheduledAt] = useState("");
  const [videasteId, setVideasteId] = useState(NONE);
  const [monteurId, setMonteurId] = useState(NONE);
  const [cmId, setCmId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fiches « Bien » disponibles comme fiche liée — utile pour un type à
  // planning (ex : le tournage se déroule sur un bien). Chargé seulement si
  // pertinent (hasPlanning, type distinct de « Bien » lui-même).
  const [relatedOptions, setRelatedOptions] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    if (!open || !type.hasPlanning || type.id === "etype_bien") return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/entities?typeId=etype_bien");
        if (!r.ok) return;
        const data = (await r.json()) as { entities: { id: string; label: string }[] };
        if (!cancelled) setRelatedOptions(data.entities);
      } catch {
        /* liste indisponible — le champ reste vide */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, type.hasPlanning, type.id]);

  function reset() {
    setLabel("");
    setFields({});
    setAccountId(NONE);
    setRelatedEntityId(NONE);
    setScheduledAt("");
    setVideasteId(NONE);
    setMonteurId(NONE);
    setCmId(NONE);
    setNotes("");
    setError(null);
  }

  async function submit() {
    setError(null);
    if (!label.trim()) return setError("Un libellé est requis");
    if (type.hasAccount && !accountId) return setError("Un compte est requis");
    if (type.hasPlanning && !scheduledAt) return setError("Une date est requise");
    for (const f of type.fieldSchema) {
      if (f.required && !fields[f.key]?.trim()) {
        return setError(`Le champ « ${f.label} » est requis`);
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          label: label.trim(),
          fields,
          accountId: type.hasAccount ? accountId || null : null,
          relatedEntityId: relatedEntityId || null,
          scheduledAt: type.hasPlanning ? new Date(scheduledAt).toISOString() : null,
          assigneeVideasteId: type.hasAssignees ? videasteId || null : null,
          defaultAssigneeMonteurId: type.hasAssignees ? monteurId || null : null,
          defaultAssigneeCmId: type.hasAssignees ? cmId || null : null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Erreur de création");
      }
      const entity = (await res.json()) as { id: string };
      toast.success("Fiche créée");
      reset();
      onClose();
      router.push(`/fiches/${entity.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de création");
    } finally {
      setSubmitting(false);
    }
  }

  const toSelectOptions = (opts: Option[]) => [
    { value: NONE, label: "— Aucun —" },
    ...opts.map((o) => ({ value: o.id, label: o.name })),
  ];

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <Modal.Header onClose={onClose}>Nouvelle fiche « {type.name} »</Modal.Header>
      <Modal.Body className="space-y-4 max-h-[70vh] overflow-y-auto">
        <FormField label="Libellé" required>
          <Input value={label} onChange={setLabel} placeholder={`Ex : ${type.name} …`} />
        </FormField>

        {(type.hasAccount || (type.hasPlanning && relatedOptions.length > 0)) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {type.hasAccount && (
              <FormField label="Compte Instagram" required>
                <Combobox
                  value={accountId}
                  onChange={setAccountId}
                  options={accounts.map((a) => ({
                    value: a.id,
                    label: `${a.name} · @${a.handle}`,
                    keywords: [a.handle],
                  }))}
                  placeholder="Choisir un compte…"
                />
              </FormField>
            )}
            {type.hasPlanning && relatedOptions.length > 0 && (
              <FormField label="Fiche liée (optionnel)">
                <Combobox
                  value={relatedEntityId}
                  onChange={setRelatedEntityId}
                  options={[
                    { value: NONE, label: "— Aucune —" },
                    ...relatedOptions.map((p) => ({ value: p.id, label: p.label })),
                  ]}
                  placeholder="Choisir une fiche…"
                />
              </FormField>
            )}
          </div>
        )}

        {type.hasPlanning && (
          <FormField label="Date et heure" required>
            <DateTimeField value={scheduledAt} onChange={setScheduledAt} />
          </FormField>
        )}

        {type.fieldSchema.length > 0 && (
          <div className="space-y-3">
            {type.fieldSchema.map((f) => (
              <CustomFieldValueInput
                key={f.key}
                field={f}
                value={fields[f.key] ?? ""}
                onChange={(v) => setFields((prev) => ({ ...prev, [f.key]: v }))}
                showLabel
              />
            ))}
          </div>
        )}

        {type.hasAssignees && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Vidéaste">
              <Select value={videasteId} onChange={setVideasteId} options={toSelectOptions(videastes)} placeholder="—" />
            </FormField>
            <FormField label="Monteur par défaut">
              <Select value={monteurId} onChange={setMonteurId} options={toSelectOptions(monteurs)} placeholder="—" />
            </FormField>
            <FormField label="CM par défaut">
              <Select value={cmId} onChange={setCmId} options={toSelectOptions(cms)} placeholder="—" />
            </FormField>
          </div>
        )}

        {type.hasPlanning && (
          <FormField label="Notes (optionnel)">
            <Textarea value={notes} onChange={setNotes} rows={2} placeholder="Consignes…" />
          </FormField>
        )}

        {error && <p className="text-[12px] text-danger-700">{error}</p>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={submit} loading={submitting}>
          Créer la fiche
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
