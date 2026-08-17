"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { EntityPicker } from "@/components/entities/EntityPicker";
import { toast } from "@/components/ui/Toast";

interface SlotEntitySelectProps {
  slotId: string;
  initialPropertyId: string | null;
  /**
   * Type de fiche exigé par la recette effective (requiresEntityTypeId, avec
   * fallback legacy requiresProperty → « Bien » côté appelant). null/undefined
   * = la recette n'exige rien, toutes les fiches sont proposées.
   */
  requiredEntityTypeId?: string | null;
  disabled?: boolean;
  /** Callback après un changement réussi (maj optimiste éventuelle côté parent). */
  onChanged?: (propertyId: string | null) => void;
}

/**
 * SlotEntitySelect (ex-SlotPropertySelect, V3) — rattache ou détache la fiche
 * partagée d'une publication EXISTANTE via PATCH /api/calendar/slots/[id]
 * (clé API `propertyId`, whitelistée ADMIN/CM). Suit le type de fiche exigé
 * par la recette au lieu de hardcoder « Bien », et offre un lien direct vers
 * la fiche liée. Réutilisé sur la fiche publication et le drawer calendrier.
 */
export function SlotEntitySelect({
  slotId,
  initialPropertyId,
  requiredEntityTypeId,
  disabled = false,
  onChanged,
}: SlotEntitySelectProps) {
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
        toast.error(d.error ?? "Échec du changement de fiche.");
        setPropertyId(prev);
        return;
      }
      toast.success(next ? "Fiche rattachée." : "Fiche détachée.");
      onChanged?.(next || null);
    } catch {
      toast.error("Erreur réseau.");
      setPropertyId(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1">
      <EntityPicker
        typeId={requiredEntityTypeId ?? undefined}
        value={propertyId}
        onChange={handleChange}
        placeholder="Aucune fiche"
        disabled={disabled || saving}
        emptyLabel="Aucune fiche"
      />
      {propertyId && (
        <Link
          href={`/fiches/${propertyId}`}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          <ExternalLink size={11} />
          Ouvrir la fiche
        </Link>
      )}
    </div>
  );
}
