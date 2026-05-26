"use client";

import { useEffect, useRef, useState } from "react";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Subset of CoverAutoConfig from @/types/template that we expose as structured fields.
 * - enabled (boolean)
 * - frameCount (number, 6-72)
 * - overlayGroupIds (string[], requires templateId to show group picker)
 *
 * Complex fields (excludeZones, excludeSlotIds) are kept as an "advanced" JSON textarea
 * because they reference template group IDs that need a separate UI to resolve.
 */
type PartialCoverConfig = {
  enabled?: boolean;
  frameCount?: number;
  overlayGroupIds?: string[];
  // Advanced fields kept as raw JSON
  [key: string]: unknown;
};

type TemplateGroup = { id: string; name?: string };

type Props = {
  /** Template ID — used to fetch the overlay groups available in the template. */
  templateId: string | null;
  /** Current CoverAutoConfig value (already parsed from JSON). */
  value: object | null;
  onChange: (config: object) => void;
};

// ─── CoverConfigEditor ────────────────────────────────────────────────────────

export function CoverConfigEditor({ templateId, value, onChange }: Props) {
  const config = (value ?? {}) as PartialCoverConfig;

  const [groups, setGroups] = useState<TemplateGroup[]>([]);
  // advancedJson is local input state; initialized once from the incoming value.
  // We use a ref to track if it was ever initialized so we can reset on open.
  const [advancedJson, setAdvancedJson] = useState<string>(() => buildAdvancedJson(config));
  const [advancedError, setAdvancedError] = useState<string | undefined>(undefined);
  const prevTemplateIdRef = useRef<string | null | undefined>(undefined);

  // Fetch template groups when templateId changes (async, no sync setState in effect body)
  useEffect(() => {
    let cancelled = false;
    const newTplId = templateId;
    // Only re-fetch if templateId actually changed
    if (newTplId === prevTemplateIdRef.current) return;
    prevTemplateIdRef.current = newTplId;

    async function load() {
      if (!newTplId) {
        if (!cancelled) setGroups([]);
        return;
      }
      try {
        const res = await fetch(`/api/templates/${newTplId}`);
        if (cancelled || !res.ok) return;
        const data = await res.json() as { groups?: TemplateGroup[] };
        if (!cancelled) setGroups(data.groups ?? []);
      } catch {
        // Non-fatal
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [templateId]);

  function patch(partial: Partial<PartialCoverConfig>) {
    onChange({ ...config, ...partial });
  }

  function handleAdvancedChange(raw: string) {
    setAdvancedJson(raw);
    if (!raw.trim()) {
      const { excludeZones: _ez, excludeSlotIds: _esi, ...rest } = config;
      void _ez; void _esi;
      onChange(rest);
      setAdvancedError(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<PartialCoverConfig>;
      setAdvancedError(undefined);
      // Merge advanced fields (only excludeZones + excludeSlotIds) into config
      const updated = { ...config };
      if ("excludeZones" in parsed) updated.excludeZones = parsed.excludeZones;
      if ("excludeSlotIds" in parsed) updated.excludeSlotIds = parsed.excludeSlotIds;
      onChange(updated);
    } catch {
      setAdvancedError("JSON invalide");
    }
  }

  function toggleOverlayGroup(groupId: string, checked: boolean) {
    const current = config.overlayGroupIds ?? [];
    const updated = checked
      ? [...current, groupId]
      : current.filter((id) => id !== groupId);
    patch({ overlayGroupIds: updated });
  }

  const selectedOverlayIds = new Set(config.overlayGroupIds ?? []);

  return (
    <div className="flex flex-col gap-4">

      {/* enabled */}
      <label className="inline-flex items-center gap-3 cursor-pointer">
        <div className="relative">
          <input
            type="checkbox"
            checked={config.enabled ?? false}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="sr-only"
          />
          <div
            className={`w-9 h-5 rounded-full transition-colors ${config.enabled ? "bg-indigo-600" : "bg-gray-200"}`}
          />
          <div
            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${config.enabled ? "translate-x-4" : "translate-x-0"}`}
          />
        </div>
        <span className="text-sm text-gray-700">Activer la génération automatique de cover</span>
      </label>

      {/* frameCount */}
      <FormField
        label="Nombre de frames proposées"
        help="Entre 6 et 72. Défaut : 36."
      >
        <Input
          type="number"
          value={String(config.frameCount ?? 36)}
          onChange={(v) => {
            const n = parseInt(v, 10);
            patch({ frameCount: Number.isFinite(n) ? Math.min(72, Math.max(6, n)) : 36 });
          }}
          min={6}
          max={72}
        />
      </FormField>

      {/* overlayGroupIds */}
      {templateId && (
        <FormField
          label="Groupes overlay à reprendre sur la cover"
          help="Groupes du template qui seront composés par-dessus le frame sélectionné."
        >
          {groups.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Aucun groupe trouvé dans ce template.</p>
          ) : (
            <div className="flex flex-wrap gap-2 mt-1">
              {groups.map((group) => {
                const isSelected = selectedOverlayIds.has(group.id);
                return (
                  <label
                    key={group.id}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-indigo-50 border-indigo-300 text-indigo-700 font-medium"
                        : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => toggleOverlayGroup(group.id, e.target.checked)}
                      className="sr-only"
                    />
                    {group.name ?? group.id}
                  </label>
                );
              })}
            </div>
          )}
        </FormField>
      )}

      {!templateId && (
        <p className="text-xs text-gray-400 italic">
          Sélectionnez un template pour choisir les groupes overlay disponibles.
        </p>
      )}

      {/* Advanced: excludeZones + excludeSlotIds as JSON */}
      <FormField
        label="Zones d'exclusion avancées (optionnel)"
        help="Permet d'exclure des plages temporelles (excludeZones) ou des slots spécifiques (excludeSlotIds). Laisser vide si inutile. Format JSON attendu."
        error={advancedError}
      >
        <Textarea
          value={advancedJson}
          onChange={handleAdvancedChange}
          placeholder={'{\n  "excludeZones": [],\n  "excludeSlotIds": []\n}'}
          rows={4}
          error={advancedError}
        />
      </FormField>

    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildAdvancedJson(config: PartialCoverConfig): string {
  const advanced: Record<string, unknown> = {};
  if (config.excludeZones !== undefined) advanced.excludeZones = config.excludeZones;
  if (config.excludeSlotIds !== undefined) advanced.excludeSlotIds = config.excludeSlotIds;
  return Object.keys(advanced).length > 0 ? JSON.stringify(advanced, null, 2) : "";
}
