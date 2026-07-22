"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Combobox } from "@/components/ui/Combobox";
import { Select } from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";

interface Option {
  id: string;
  name: string;
}

export interface CreateEventModalProps {
  open: boolean;
  onClose: () => void;
  accounts: { id: string; name: string; handle: string }[];
  properties: { id: string; label: string }[];
  videastes: Option[];
  monteurs: Option[];
  cms: Option[];
}

const NONE = "";

export function CreateEventModal({
  open,
  onClose,
  accounts,
  properties,
  videastes,
  monteurs,
  cms,
}: CreateEventModalProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [accountId, setAccountId] = useState(NONE);
  const [propertyId, setPropertyId] = useState(NONE);
  const [scheduledAt, setScheduledAt] = useState("");
  const [videasteId, setVideasteId] = useState(NONE);
  const [monteurId, setMonteurId] = useState(NONE);
  const [cmId, setCmId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setAccountId(NONE);
    setPropertyId(NONE);
    setScheduledAt("");
    setVideasteId(NONE);
    setMonteurId(NONE);
    setCmId(NONE);
    setNotes("");
    setError(null);
  }

  async function submit() {
    setError(null);
    if (!title.trim()) return setError("Un titre est requis");
    if (!accountId) return setError("Un compte est requis");
    if (!scheduledAt) return setError("Une date de tournage est requise");

    setSubmitting(true);
    try {
      const res = await fetch("/api/shoot-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          accountId,
          propertyId: propertyId || null,
          scheduledAt: new Date(scheduledAt).toISOString(),
          assigneeVideasteId: videasteId || null,
          defaultAssigneeMonteurId: monteurId || null,
          defaultAssigneeCmId: cmId || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Erreur de création");
      }
      const event = (await res.json()) as { id: string };
      toast.success("Événement créé");
      reset();
      onClose();
      router.push(`/events/${event.id}`);
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
      <Modal.Header onClose={onClose}>Nouvel événement de tournage</Modal.Header>
      <Modal.Body className="space-y-4 max-h-[70vh] overflow-y-auto">
        <FormField label="Titre" required>
          <Input value={title} onChange={setTitle} placeholder="Ex : Tournage Villa Cannes" />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Compte Instagram" required>
            <Combobox
              value={accountId}
              onChange={setAccountId}
              options={accounts.map((a) => ({ value: a.id, label: `${a.name} · @${a.handle}`, keywords: [a.handle] }))}
              placeholder="Choisir un compte…"
            />
          </FormField>
          <FormField label="Bien (optionnel)">
            <Combobox
              value={propertyId}
              onChange={setPropertyId}
              options={[{ value: NONE, label: "— Aucun —" }, ...properties.map((p) => ({ value: p.id, label: p.label }))]}
              placeholder="Choisir un bien…"
            />
          </FormField>
        </div>

        <FormField label="Date et heure du tournage" required>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full h-8 rounded-md bg-card border border-input px-2.5 text-[13px] text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
          />
        </FormField>

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

        <FormField label="Notes (optionnel)">
          <Textarea value={notes} onChange={setNotes} rows={2} placeholder="Consignes de tournage…" />
        </FormField>

        {error && <p className="text-[12px] text-danger-700">{error}</p>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={submit} loading={submitting}>
          Créer l&apos;événement
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
