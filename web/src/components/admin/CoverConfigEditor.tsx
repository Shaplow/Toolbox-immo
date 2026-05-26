"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FormField } from "@/components/ui/FormField";

// ─── Types ────────────────────────────────────────────────────────────────────

type CoverPreset = {
  id: string;
  name: string;
  sortOrder: number;
  config: Record<string, unknown>;
};

type PartialCoverConfig = {
  enabled?: boolean;
  coverPresetName?: string | null;
};

type Props = {
  /** Template ID — used to fetch the available presets for this template. */
  templateId: string | null;
  /** Current coverConfig value (already parsed from JSON). Only { enabled, coverPresetName } are used. */
  value: object | null;
  onChange: (config: object) => void;
};

// ─── CoverConfigEditor ────────────────────────────────────────────────────────

export function CoverConfigEditor({ templateId, value, onChange }: Props) {
  const config = (value ?? {}) as PartialCoverConfig;

  const [presets, setPresets] = useState<CoverPreset[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch available presets when templateId changes
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!templateId) {
        if (!cancelled) { setPresets([]); setLoading(false); }
        return;
      }
      if (!cancelled) setLoading(true);
      try {
        const r = await fetch(`/api/templates/${templateId}/cover-presets`);
        const data: CoverPreset[] = r.ok ? await (r.json() as Promise<CoverPreset[]>) : [];
        if (!cancelled) setPresets(data);
      } catch {
        // Non-fatal
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateId]);

  function patch(partial: Partial<PartialCoverConfig>) {
    onChange({ ...config, ...partial });
  }

  // ── No template selected ──────────────────────────────────────────────────

  if (!templateId) {
    return (
      <p className="text-sm text-gray-500 italic">
        Sélectionne d&apos;abord un template dans la section Source pour configurer la cover automatique.
      </p>
    );
  }

  // ── Template selected ─────────────────────────────────────────────────────

  const selectedPreset = presets.find((p) => p.name === config.coverPresetName) ?? null;

  return (
    <div className="flex flex-col gap-4">

      {/* enabled toggle */}
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

      {/* Preset picker */}
      {loading ? (
        <p className="text-sm text-gray-400 italic">Chargement des presets…</p>
      ) : presets.length === 0 ? (
        <p className="text-sm text-gray-500">
          Ce template n&apos;a aucun preset cover.{" "}
          <Link
            href={`/templates/${templateId}/edit`}
            className="text-indigo-600 underline hover:text-indigo-700"
            target="_blank"
            rel="noopener noreferrer"
          >
            Va dans le builder template
          </Link>{" "}
          pour en créer.
        </p>
      ) : (
        <FormField
          label="Preset cover"
          help="Sélectionne le preset cover à utiliser pour ce pattern."
        >
          <select
            value={config.coverPresetName ?? ""}
            onChange={(e) => patch({ coverPresetName: e.target.value || null })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
          >
            <option value="" disabled>Choisir un preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </FormField>
      )}

      {/* Summary of selected preset */}
      {selectedPreset && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-xs text-indigo-700 space-y-0.5">
          <p className="font-medium">{selectedPreset.name}</p>
          <p>
            {Array.isArray((selectedPreset.config as { overlayGroupIds?: unknown[] }).overlayGroupIds)
              ? `${(selectedPreset.config as { overlayGroupIds: unknown[] }).overlayGroupIds.length} groupe(s) overlay`
              : "—"}{" "}
            &middot;{" "}
            {typeof (selectedPreset.config as { frameCount?: number }).frameCount === "number"
              ? `${(selectedPreset.config as { frameCount: number }).frameCount} frames`
              : "36 frames"}
          </p>
        </div>
      )}

      {/* Warning if coverPresetName set but preset not found */}
      {config.coverPresetName && !selectedPreset && presets.length > 0 && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Le preset &laquo;{config.coverPresetName}&raquo; est introuvable dans ce template.
          Sélectionne-en un autre.
        </p>
      )}

    </div>
  );
}
