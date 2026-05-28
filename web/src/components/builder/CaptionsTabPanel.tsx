"use client";

import { useEffect, useState } from "react";
import { Plus, X, Link2 } from "lucide-react";
import Link from "next/link";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { CaptionExcludeZone } from "@/types/template";

interface LinkedPattern {
  id: string;
  label: string;
  isActive: boolean;
  accountId: string;
  accountHandle: string;
  captionPresetId: string | null;
}

/**
 * Onglet "Sous-titres auto" du builder.
 * Présenté en tab séparé pour rendre la config visible et éviter qu'elle se
 * perde dans la longue page Paramètres.
 *
 * Si on a un templateId, on liste les patterns qui pointent vers ce template
 * pour rendre visible l'impact des changements sur le calendrier.
 */
export function CaptionsTabPanel({ templateId }: { templateId?: string }) {
  const { template, updateCaptionAutoConfig } = useBuilderStore();
  const captionAutoConfig = template.captionAutoConfig;

  const [captionPresets, setCaptionPresets] = useState<{ id: string; name: string }[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [captionPrompts, setCaptionPrompts] = useState<{ id: string; name: string }[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [linkedPatterns, setLinkedPatterns] = useState<LinkedPattern[]>([]);

  // Charge les patterns qui utilisent ce template — surface l'impact du changement.
  useEffect(() => {
    if (!templateId) return;
    let active = true;
    fetch(`/api/templates/${templateId}/usage`)
      .then((r) => (r.ok ? (r.json() as Promise<{ patterns: LinkedPattern[] }>) : { patterns: [] }))
      .then((data) => { if (active) setLinkedPatterns(data.patterns); })
      .catch(() => {});
    return () => { active = false; };
  }, [templateId]);

  useEffect(() => {
    let active = true;
    setLoadingPresets(true);
    fetch("/api/caption-presets")
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string; name: string }[]>) : []))
      .then((data) => { if (active) setCaptionPresets(data); })
      .catch(() => {})
      .finally(() => { if (active) setLoadingPresets(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingPrompts(true);
    fetch("/api/caption-prompts")
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string; name: string }[]>) : []))
      .then((data) => { if (active) setCaptionPrompts(data); })
      .catch(() => {})
      .finally(() => { if (active) setLoadingPrompts(false); });
    return () => { active = false; };
  }, []);

  const enabled = captionAutoConfig?.enabled ?? false;

  return (
    <div className="flex flex-col h-full overflow-y-auto text-xs">
      <div className="px-3 py-3 border-b border-gray-100">
        <p className="text-[11px] text-gray-500 mb-3">
          Génère automatiquement les sous-titres après chaque rendu du template.
          La config par défaut est appliquée à toute publication utilisant ce template
          (sauf override slot/pattern).
        </p>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => updateCaptionAutoConfig({ enabled: e.target.checked })}
            className="rounded"
          />
          <span className="text-gray-700 font-medium">Activer après chaque render</span>
        </label>
      </div>

      {/* Patterns liés — visibilité de l'impact des changements */}
      {linkedPatterns.length > 0 && (
        <div className="px-3 py-3 border-b border-gray-100">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1">
            <Link2 size={10} />
            Patterns utilisant ce template ({linkedPatterns.length})
          </p>
          <div className="space-y-1">
            {linkedPatterns.map((p) => (
              <Link
                key={p.id}
                href={`/admin/accounts/${p.accountId}`}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-gray-50 transition-colors group"
                title="Voir la fiche compte"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-700 truncate group-hover:text-gray-900">{p.label}</span>
                    {!p.isActive && (
                      <span className="text-[9px] px-1 rounded bg-gray-100 text-gray-500 border border-gray-200 shrink-0">
                        inactif
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 truncate">@{p.accountHandle}</p>
                </div>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
                    p.captionPresetId
                      ? "bg-violet-50 text-violet-700 border border-violet-200"
                      : "bg-gray-100 text-gray-500 border border-gray-200"
                  }`}
                  title={p.captionPresetId ? "Caption preset défini sur le pattern" : "Utilise le défaut template"}
                >
                  {p.captionPresetId ? "preset" : "défaut"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!enabled ? (
        <div className="px-3 py-3 text-[11px] text-gray-400 italic">
          Active la case ci-dessus pour configurer le preset, les zones d&apos;exclusion et la correction IA.
        </div>
      ) : (
        <>
          {/* Preset */}
          <div className="px-3 py-3 border-b border-gray-100">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Preset sous-titres
            </p>
            {loadingPresets ? (
              <span className="text-[10px] text-gray-400 italic">Chargement…</span>
            ) : captionPresets.length === 0 ? (
              <span className="text-[10px] text-gray-400 italic">
                Aucun preset disponible. Crée-en un dans <code>/tools/captions</code>.
              </span>
            ) : (
              <select
                value={captionAutoConfig?.presetId ?? ""}
                onChange={(e) => updateCaptionAutoConfig({ presetId: e.target.value || undefined })}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs bg-white"
              >
                <option value="">— Sélectionner un preset —</option>
                {captionPresets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Zones d'exclusion */}
          <div className="px-3 py-3 border-b border-gray-100">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Zones sans sous-titres
            </p>
            {(template.videoSequence?.length ?? 0) > 0 ? (
              <div className="space-y-1">
                {(template.videoSequence ?? []).map((slot) => {
                  const isExcluded = (captionAutoConfig?.excludeSlotIds ?? []).includes(slot.id);
                  return (
                    <label key={slot.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isExcluded}
                        onChange={(e) => {
                          const current = captionAutoConfig?.excludeSlotIds ?? [];
                          const updated = e.target.checked
                            ? [...current, slot.id]
                            : current.filter((id) => id !== slot.id);
                          updateCaptionAutoConfig({ excludeSlotIds: updated });
                        }}
                        className="rounded"
                      />
                      <span className="text-xs text-gray-600">{slot.label ?? "Slot"}</span>
                      {slot.maxDuration !== undefined && (
                        <span className="text-[9px] text-gray-400">({slot.maxDuration}s max)</span>
                      )}
                    </label>
                  );
                })}
              </div>
            ) : (
              <>
                {(captionAutoConfig?.excludeZones ?? []).map((zone, i) => (
                  <div key={zone.id} className="mb-2 rounded-lg border border-gray-100 bg-gray-50 p-2 space-y-1.5">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        placeholder="Label (ex: outro)"
                        value={zone.label}
                        onChange={(e) => {
                          const zones = [...(captionAutoConfig?.excludeZones ?? [])];
                          zones[i] = { ...zones[i], label: e.target.value };
                          updateCaptionAutoConfig({ excludeZones: zones });
                        }}
                        className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const zones = (captionAutoConfig?.excludeZones ?? []).filter((_, j) => j !== i);
                          updateCaptionAutoConfig({ excludeZones: zones });
                        }}
                        className="text-gray-400 hover:text-red-500 p-1 transition-colors"
                        title="Supprimer cette zone"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-gray-400 text-[10px]">Début — groupe</span>
                      <select
                        value={zone.startGroupId ?? ""}
                        onChange={(e) => {
                          const zones = [...(captionAutoConfig?.excludeZones ?? [])];
                          zones[i] = { ...zones[i], startGroupId: e.target.value || undefined };
                          updateCaptionAutoConfig({ excludeZones: zones });
                        }}
                        className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
                      >
                        <option value="">— Timestamp explicite —</option>
                        {template.groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                      {!zone.startGroupId && (
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          placeholder="Secondes"
                          value={zone.startTime ?? ""}
                          onChange={(e) => {
                            const zones = [...(captionAutoConfig?.excludeZones ?? [])];
                            zones[i] = { ...zones[i], startTime: e.target.value ? Number(e.target.value) : undefined };
                            updateCaptionAutoConfig({ excludeZones: zones });
                          }}
                          className="border border-gray-200 rounded px-2 py-1 text-xs"
                        />
                      )}
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-gray-400 text-[10px]">Fin — groupe</span>
                      <select
                        value={zone.endGroupId ?? ""}
                        onChange={(e) => {
                          const zones = [...(captionAutoConfig?.excludeZones ?? [])];
                          zones[i] = { ...zones[i], endGroupId: e.target.value || undefined };
                          updateCaptionAutoConfig({ excludeZones: zones });
                        }}
                        className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
                      >
                        <option value="">— Fin de vidéo —</option>
                        {template.groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                      {!zone.endGroupId && (
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          placeholder="Secondes (fin de vidéo si vide)"
                          value={zone.endTime ?? ""}
                          onChange={(e) => {
                            const zones = [...(captionAutoConfig?.excludeZones ?? [])];
                            zones[i] = { ...zones[i], endTime: e.target.value ? Number(e.target.value) : undefined };
                            updateCaptionAutoConfig({ excludeZones: zones });
                          }}
                          className="border border-gray-200 rounded px-2 py-1 text-xs"
                        />
                      )}
                    </label>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const safeZone: CaptionExcludeZone = { id: `zone-${Date.now()}`, label: "" };
                    const zones = [...(captionAutoConfig?.excludeZones ?? []), safeZone];
                    updateCaptionAutoConfig({ excludeZones: zones });
                  }}
                  className="flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-700"
                >
                  <Plus size={11} />
                  Ajouter une zone
                </button>
              </>
            )}
          </div>

          {/* Correction IA */}
          <div className="px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Correction IA
            </p>
            <label className="flex flex-col gap-0.5 mb-2">
              <span className="text-gray-500">Prompt de correction</span>
              {loadingPrompts ? (
                <span className="text-[10px] text-gray-400 italic">Chargement…</span>
              ) : captionPrompts.length === 0 ? (
                <span className="text-[10px] text-gray-400 italic">Aucun prompt disponible.</span>
              ) : (
                <select
                  value={captionAutoConfig?.correctionPromptId ?? ""}
                  onChange={(e) => updateCaptionAutoConfig({ correctionPromptId: e.target.value || undefined })}
                  className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
                >
                  <option value="">— Désactivée —</option>
                  {captionPrompts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </label>
            {captionAutoConfig?.correctionPromptId && (
              <label className="flex flex-col gap-0.5">
                <span className="text-gray-500">Modèle IA</span>
                <select
                  value={captionAutoConfig?.correctionModel ?? "claude"}
                  onChange={(e) => updateCaptionAutoConfig({ correctionModel: e.target.value as "claude" | "gpt" })}
                  className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
                >
                  <option value="claude">Claude (Anthropic)</option>
                  <option value="gpt">GPT (OpenAI)</option>
                </select>
              </label>
            )}
          </div>
        </>
      )}
    </div>
  );
}
