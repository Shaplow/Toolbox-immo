"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";

export interface AttachReelModalProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  /** Recettes (bindings) disponibles pour le compte de l'événement. */
  recipes: { id: string; label: string }[];
}

export function AttachReelModal({ open, onClose, eventId, recipes }: AttachReelModalProps) {
  const router = useRouter();
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (recipes.length > 0 && !recipeId) return setError("Choisissez une recette");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/shoot-events/${eventId}/reels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patternBindingId: recipeId || null,
          title: title.trim() || null,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Erreur d'ajout");
      }
      toast.success("Reel ajouté");
      setTitle("");
      setScheduledAt("");
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'ajout");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="md">
      <Modal.Header onClose={onClose}>Ajouter un reel</Modal.Header>
      <Modal.Body className="space-y-4">
        <p className="text-[12.5px] text-muted-foreground">
          Le reel démarre directement au montage (les rushs du tournage sont partagés). Le
          nombre de reels est libre : ajoutez-en autant que nécessaire.
        </p>

        {recipes.length > 0 ? (
          <FormField label="Recette" required>
            <Select
              value={recipeId}
              onChange={setRecipeId}
              options={recipes.map((r) => ({ value: r.id, label: r.label }))}
              placeholder="Choisir une recette…"
            />
          </FormField>
        ) : (
          <p className="text-[12px] text-warning-700 bg-warning-50 border border-warning-200 rounded-md px-3 py-2">
            Aucune recette active sur ce compte. Configurez une recette pour ce compte avant
            d&apos;ajouter des reels.
          </p>
        )}

        <FormField label="Titre (optionnel)" help="Par défaut : le nom de la recette.">
          <Input value={title} onChange={setTitle} placeholder="Ex : Reel visite salon" />
        </FormField>

        <FormField label="Date de publication (optionnel)" help="Vide = reel en banque (à planifier plus tard).">
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full h-8 rounded-md bg-card border border-input px-2.5 text-[13px] text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
          />
        </FormField>

        {error && <p className="text-[12px] text-danger-700">{error}</p>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={submit} loading={submitting} disabled={recipes.length === 0}>
          Ajouter le reel
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
