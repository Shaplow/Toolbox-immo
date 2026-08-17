"use client";

import { useEffect, useState } from "react";
import { Combobox } from "@/components/ui/Combobox";

export interface EntityPickerProps {
  /** Filtre le type de fiche (ex : "etype_bien"). Omis = toutes les fiches accessibles. */
  typeId?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Libellé de l'option vide (défaut : « Aucune fiche »). */
  emptyLabel?: string;
}

/**
 * EntityPicker — sélecteur de fiche (Entity) générique. Remplace
 * `SlotEntitySelect` et les selects de fiches ad hoc d'AddSlotModal /
 * MissionForm / CreateEventModal : un seul composant, un seul fetch
 * `/api/entities?typeId=`.
 */
export function EntityPicker({
  typeId,
  value,
  onChange,
  placeholder,
  disabled = false,
  emptyLabel = "Aucune fiche",
}: EntityPickerProps) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const qs = typeId ? `?typeId=${encodeURIComponent(typeId)}` : "";
      try {
        const res = await fetch(`/api/entities${qs}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { entities: { id: string; label: string }[] };
        if (!cancelled) setOptions(data.entities.map((e) => ({ value: e.id, label: e.label })));
      } catch {
        /* liste indisponible — le picker reste vide */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [typeId]);

  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={[{ value: "", label: emptyLabel }, ...options]}
      placeholder={loading ? "Chargement…" : placeholder ?? emptyLabel}
      disabled={disabled || loading}
    />
  );
}
