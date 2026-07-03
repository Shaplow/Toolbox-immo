"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/Select";
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
 * whitelisté ADMIN/CM). Charge la liste des biens à la volée. Réutilisé sur la
 * fiche publication et le drawer calendrier.
 */
export function SlotPropertySelect({
  slotId,
  initialPropertyId,
  disabled = false,
  onChanged,
}: SlotPropertySelectProps) {
  const [propertyId, setPropertyId] = useState(initialPropertyId ?? "");
  const [options, setOptions] = useState<{ value: string; label: string }[]>([
    { value: "", label: "Aucun bien" },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/properties");
        if (!res.ok) return;
        const data = (await res.json()) as { id: string; label: string }[];
        if (cancelled) return;
        setOptions([
          { value: "", label: "Aucun bien" },
          ...data.map((p) => ({ value: p.id, label: p.label })),
        ]);
      } catch {
        /* liste indisponible — le Select reste avec « Aucun bien » */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    <Select
      value={propertyId}
      onChange={handleChange}
      options={options}
      placeholder="Aucun bien"
      disabled={disabled || saving}
    />
  );
}
