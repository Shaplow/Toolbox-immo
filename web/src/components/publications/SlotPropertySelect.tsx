"use client";

import { useState } from "react";
import { EntityPicker } from "@/components/entities/EntityPicker";
import { toast } from "@/components/ui/Toast";

interface SlotPropertySelectProps {
  slotId: string;
  initialPropertyId: string | null;
  disabled?: boolean;
  /** Callback après un changement réussi (maj optimiste éventuelle côté parent). */
  onChanged?: (propertyId: string | null) => void;
}

/**
 * Sélecteur de « Bien » (fiche partagée) pour une mission EXISTANTE — rattache
 * ou détache le bien via PATCH /api/calendar/slots/[id] (champ propertyId,
 * whitelisté ADMIN/CM). Wrapper mince sur `EntityPicker` (fiches de type
 * « Bien » uniquement) — plan simplification Phase 5. Réutilisé sur la fiche
 * publication et le drawer calendrier.
 */
export function SlotPropertySelect({
  slotId,
  initialPropertyId,
  disabled = false,
  onChanged,
}: SlotPropertySelectProps) {
  const [propertyId, setPropertyId] = useState(initialPropertyId ?? "");
  const [saving, setSaving] = useState(false);

  async function handleChange(next: string) {
    const prev = propertyId;
    setPropertyId(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/calendar/slots/${slotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: next || null }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(d.error ?? "Échec du changement de bien.");
        setPropertyId(prev);
        return;
      }
      toast.success(next ? "Bien rattaché." : "Bien détaché.");
      onChanged?.(next || null);
    } catch {
      toast.error("Erreur réseau.");
      setPropertyId(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <EntityPicker
      typeId="etype_bien"
      value={propertyId}
      onChange={handleChange}
      placeholder="Aucun bien"
      disabled={disabled || saving}
      emptyLabel="Aucun bien"
    />
  );
}
