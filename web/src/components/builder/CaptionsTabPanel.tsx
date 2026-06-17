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
  // Initial true : on est en train de fetch dès le mount, évite le pattern
  // setState(true) dans useEffect (interdit par react-hooks/set-state-in-effect).
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [captionPrompts, setCaptionPrompts] = useState<{ id: string; name: string }[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(true);
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
    fetch("/api/caption-presets")
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string; name: string }[]>) : []))
      .then((data) => { if (active) setCaptionPresets(data); })
      .catch(() => {})
      .finally(() => { if (active) setLoadingPresets(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
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
      <div className="px-3 py-3 border-b border-border">
        <p className="text-[11px] text-muted-foreground mb-3">
          Génère automatiquement les sous-titres après chaque rendu. La config par défaut s&apos;applique à toute publication utilisant ce template (sauf override slot ou pattern).
        </p>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => updateCaptionAutoConfig({ enabled: e.target.checked })}
            className="rounded"
          />
          <span className="text-foreground font-medium">Activer après chaque render</span>
        </label>
      </div>

      {/* Patterns liés — visibilité de l'impact des changements */}
      {linkedPatterns.length > 0 && (
        <div className="px-3 py-3 border-b border-border">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
            <Link2 size={10} />
            Patterns utilisant ce template ({linkedPatterns.length})
          </p>
          <div className="space-y-1">
            {linkedPatterns.map((p) => (
              <Link
                key={p.id}
                href={`/admin/accounts/${p.accountId}`}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-muted transition-colors group"
                title="Voir la fiche compte"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-foreground truncate group-hover:text-gray-900">{p.label}</span>
                    {!p.isActive && (
                      <span className="text-[9px] px-1 rounded bg-muted text-muted-foreground border border-border shrink-0">
                        inactif
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">@{p.accountHandle}</p>
                </div>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
                    p.captionPresetId
                      ? "bg-violet-50 text-violet-700 border border-violet-200"
                      : "bg-muted text-muted-foreground border border-border"
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
        <div className="px-3 py-3 text-[11px] text-muted-foreground italic">
          Active la case ci-dessus pour configurer le preset, les zones d&apos;exclusion et la correction IA.
        </div>
      ) : (
        <>
          {/* Preset */}
          <div className="px-3 py-3 border-b border-border">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Style des sous-titres
            </p>
            {loadingPresets ? (
              <span className="text-[10px] text-muted-foreground italic">Chargement…</span>
            ) : captionPresets.length === 0 ? (
              <span className="text-[10px] text-muted-foreground italic">
                Aucun preset disponible. Crée-en un dans <code>/tools/captions</code>.
              </span>
            ) : (
              <select
                value={captionAutoConfig?.presetId ?? ""}
                onChange={(e) => updateCaptionAutoConfig({ presetId: e.target.value || undefined })}
                className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                <option value="">— Sélectionner un style —</option>
                {captionPresets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Zones d'exclusion */}
          <div className="px-3 py-3 border-b border-border">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Zones sans sous-titres
            </p>
            {(template.videoSequence?.length ?? 0) > 0 ? (
              <>
                <p className="text-[10px] text-muted-foreground mb-2">
                  Coche les clips où tu ne veux pas voir de sous-titres.
                </p>
                <div className="space-y-1 pl-3 border-l-2 border-red-200">
                  {(template.videoSequence ?? []).map((slot, idx) => {
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
                        <span className="text-xs text-muted-foreground">{slot.label ?? `Slot ${idx + 1}`}</span>
                        {slot.maxDuration !== undefined && (
                          <span className="text-[9px] text-muted-foreground">({slot.maxDuration}s max)</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <p className="text-[10px] text-muted-foreground mb-2">
                  Aucun clip défini dans ce template — définis des plages
                  temporelles à ignorer, ou ajoute des clips dans l&apos;onglet
                  Séquence.
                </p>
                {(captionAutoConfig?.excludeZones ?? []).map((zone, i) => (
                  <div key={zone.id} className="mb-2 rounded-lg border border-red-100 bg-red-50/30 p-2 space-y-1.5">
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
                        className="flex-1 border border-border rounded px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const zones = (captionAutoConfig?.excludeZones ?? []).filter((_, j) => j !== i);
                          updateCaptionAutoConfig({ excludeZones: zones });
                        }}
                        className="text-muted-foreground hover:text-red-500 p-1 transition-colors"
                        title="Supprimer cette zone"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-muted-foreground text-[10px]">Début — groupe</span>
                      <select
                        value={zone.startGroupId ?? ""}
                        onChange={(e) => {
                          const zones = [...(captionAutoConfig?.excludeZones ?? [])];
                          zones[i] = { ...zones[i], startGroupId: e.target.value || undefined };
                          updateCaptionAutoConfig({ excludeZones: zones });
                        }}
                        className="border border-border rounded px-2 py-1 text-xs bg-white"
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
                          className="border border-border rounded px-2 py-1 text-xs"
                        />
                      )}
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-muted-foreground text-[10px]">Fin — groupe</span>
                      <select
                        value={zone.endGroupId ?? ""}
                        onChange={(e) => {
                          const zones = [...(captionAutoConfig?.excludeZones ?? [])];
                          zones[i] = { ...zones[i], endGroupId: e.target.value || undefined };
                          updateCaptionAutoConfig({ excludeZones: zones });
                        }}
                        className="border border-border rounded px-2 py-1 text-xs bg-white"
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
                          className="border border-border rounded px-2 py-1 text-xs"
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
                  className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
                >
                  <Plus size={12} />
                  Ajouter une plage
                </button>
              </>
            )}
          </div>

          {/* Correction IA */}
          <div className="px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Correction IA
            </p>
            <p className="text-[10px] text-muted-foreground mb-2">
              Repasse le transcript brut dans un LLM pour corriger fautes et ponctuation avant l&apos;affichage.
            </p>
            <label className="flex flex-col gap-1 mb-2">
              <span className="text-[10px] text-muted-foreground">Prompt de correction</span>
              {loadingPrompts ? (
                <span className="text-[10px] text-muted-foreground italic">Chargement…</span>
              ) : captionPrompts.length === 0 ? (
                <span className="text-[10px] text-muted-foreground italic">Aucun prompt disponible.</span>
              ) : (
                <select
                  value={captionAutoConfig?.correctionPromptId ?? ""}
                  onChange={(e) => updateCaptionAutoConfig({ correctionPromptId: e.target.value || undefined })}
                  className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="">— Désactivée —</option>
                  {captionPrompts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </label>
            {captionAutoConfig?.correctionPromptId && (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">Modèle IA</span>
                <select
                  value={captionAutoConfig?.correctionModel ?? "claude"}
                  onChange={(e) => updateCaptionAutoConfig({ correctionModel: e.target.value as "claude" | "gpt" })}
                  className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
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
