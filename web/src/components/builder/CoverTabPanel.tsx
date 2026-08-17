"use client";

import { useEffect, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import Link from "next/link";
import { useBuilderStore } from "@/lib/store/builderStore";
import type { TemplateUsagePattern } from "@/types/patternUsage";
import { GroupSelectList } from "@/components/builder/shared/GroupSelectList";
import { toast } from "@/components/ui/Toast";

interface Props {
  templateId?: string;
}

// ─── Config locale ────────────────────────────────────────────────────────────

type CoverConfig = {
  enabled: boolean;
  frameCount: number;
  overlayGroupIds: string[];
  slotMode: "all" | "exclude" | "include";
  slotIds: string[];
};

const DEFAULT_CONFIG: CoverConfig = {
  enabled: true,
  frameCount: 36,
  overlayGroupIds: [],
  slotMode: "all",
  slotIds: [],
};

function configToApi(c: CoverConfig): Record<string, unknown> {
  return {
    enabled: c.enabled,
    frameCount: c.frameCount,
    overlayGroupIds: c.overlayGroupIds,
    excludeSlotIds: c.slotMode === "exclude" ? c.slotIds : [],
    includeSlotIds: c.slotMode === "include" ? c.slotIds : [],
    // champs avancés laissés à 0 / vide — éditables côté admin si besoin
    offsetX: 0,
    offsetY: 0,
    excludeZones: [],
  };
}

function apiToConfig(raw: unknown): CoverConfig {
  const c = (raw ?? {}) as Record<string, unknown>;
  const inc = Array.isArray(c.includeSlotIds) ? (c.includeSlotIds as string[]) : [];
  const exc = Array.isArray(c.excludeSlotIds) ? (c.excludeSlotIds as string[]) : [];
  let slotMode: CoverConfig["slotMode"] = "all";
  let slotIds: string[] = [];
  if (inc.length > 0) {
    slotMode = "include";
    slotIds = inc;
  } else if (exc.length > 0) {
    slotMode = "exclude";
    slotIds = exc;
  }
  return {
    enabled: typeof c.enabled === "boolean" ? c.enabled : true,
    frameCount: typeof c.frameCount === "number" ? c.frameCount : 36,
    overlayGroupIds: Array.isArray(c.overlayGroupIds) ? (c.overlayGroupIds as string[]) : [],
    slotMode,
    slotIds,
  };
}

// ─── Composant ────────────────────────────────────────────────────────────────

/**
 * Onglet "Cover auto" du builder.
 *
 * Pattern identique à CaptionsTabPanel : checkbox activation + cases à cocher
 * empilées, pas de preview, pas de dialog. La config est sérialisée dans le
 * preset par défaut du template (sortOrder le plus bas), auto-créé si absent.
 *
 * Save explicite via un seul appel `save()` debounce après chaque toggle —
 * status indicator inline.
 */
export function CoverTabPanel({ templateId }: Props) {
  const { template } = useBuilderStore();
  const groups = template.groups ?? [];
  const slots = template.videoSequence ?? [];

  const [presetId, setPresetId] = useState<string | null>(null);
  const [config, setConfig] = useState<CoverConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [linkedPatterns, setTemplateUsagePatterns] = useState<TemplateUsagePattern[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch preset par défaut + patterns liés ────────────────────────────────
  useEffect(() => {
    if (!templateId) return;
    let active = true;
    setLoading(true);
    fetch(`/api/templates/${templateId}/cover-presets`)
      .then((r) =>
        r.ok ? (r.json() as Promise<Array<{ id: string; sortOrder: number; config: unknown }>>) : [],
      )
      .then((data) => {
        if (!active) return;
        const sorted = [...data].sort((a, b) => a.sortOrder - b.sortOrder);
        const first = sorted[0] ?? null;
        if (first) {
          setPresetId(first.id);
          setConfig(apiToConfig(first.config));
        } else {
          setPresetId(null);
          setConfig({ ...DEFAULT_CONFIG, enabled: false });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [templateId]);

  useEffect(() => {
    if (!templateId) return;
    let active = true;
    fetch(`/api/templates/${templateId}/usage`)
      .then((r) =>
        r.ok ? (r.json() as Promise<{ patterns: TemplateUsagePattern[] }>) : { patterns: [] },
      )
      .then((data) => {
        if (active) setTemplateUsagePatterns(data.patterns);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [templateId]);

  // ── Save debounce (300ms après dernière modif) ──────────────────────────────
  function scheduleSave(next: CoverConfig) {
    setConfig(next);
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persist(next);
    }, 300);
  }

  async function persist(c: CoverConfig) {
    if (!templateId) return;
    try {
      let id = presetId;
      if (!id) {
        // Auto-create on first save
        const res = await fetch(`/api/templates/${templateId}/cover-presets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Cover par défaut",
            sortOrder: 0,
            config: configToApi(c),
          }),
        });
        if (!res.ok) throw new Error("create failed");
        const data = (await res.json()) as { id: string };
        id = data.id;
        setPresetId(id);
      } else {
        const res = await fetch(`/api/templates/${templateId}/cover-presets/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: configToApi(c) }),
        });
        if (!res.ok) throw new Error("update failed");
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("error");
      toast.error("Erreur lors de la sauvegarde");
    }
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const enabled = config.enabled;

  function toggleEnabled(v: boolean) {
    scheduleSave({ ...config, enabled: v });
  }

  function setFrameCount(n: number) {
    scheduleSave({ ...config, frameCount: Math.max(6, Math.min(72, n)) });
  }

  function toggleOverlayGroup(groupId: string, checked: boolean) {
    const next = checked
      ? [...config.overlayGroupIds, groupId]
      : config.overlayGroupIds.filter((id) => id !== groupId);
    scheduleSave({ ...config, overlayGroupIds: next });
  }

  function setSlotMode(mode: CoverConfig["slotMode"]) {
    // changement de mode → on reset les ids sélectionnés pour éviter l'ambiguïté
    scheduleSave({ ...config, slotMode: mode, slotIds: [] });
  }

  function toggleSlot(slotId: string, checked: boolean) {
    const next = checked
      ? [...config.slotIds, slotId]
      : config.slotIds.filter((id) => id !== slotId);
    scheduleSave({ ...config, slotIds: next });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!templateId) {
    return (
      <div className="flex flex-col h-full overflow-y-auto text-xs">
        <div className="px-3 py-4 text-center text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Cover auto indisponible</p>
          <p className="text-[11px] text-muted-foreground">
            Sauvegarde d&apos;abord le template pour configurer la cover automatique.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto text-xs">
      {/* Header + toggle activation */}
      <div className="px-3 py-3 border-b border-border">
        <p className="text-[11px] text-muted-foreground mb-3">
          Génère un pack de frames après chaque rendu pour que la CM choisisse la cover finale dans la fiche publication.
        </p>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggleEnabled(e.target.checked)}
            disabled={loading}
            className="rounded"
          />
          <span className="text-foreground font-medium">Activer après chaque render</span>
        </label>

        {/* Status indicator */}
        <div className="mt-2 text-[10px] h-3.5">
          {saveStatus === "saving" && <span className="text-muted-foreground">Sauvegarde…</span>}
          {saveStatus === "saved" && <span className="text-emerald-600">Sauvegardé</span>}
          {saveStatus === "error" && <span className="text-red-500">Échec — réessayez</span>}
        </div>
      </div>

      {/* Patterns liés */}
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
                    <span className="text-xs text-foreground truncate group-hover:text-gray-900">
                      {p.label}
                    </span>
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
                    p.coverEnabled
                      ? "bg-violet-50 text-violet-700 border border-violet-200"
                      : "bg-muted text-muted-foreground border border-border"
                  }`}
                >
                  {p.coverEnabled ? "actif" : "off"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Config (visible uniquement si activé) */}
      {!enabled ? (
        <div className="px-3 py-3 text-[11px] text-muted-foreground italic">
          Active la case ci-dessus pour configurer les frames, les clips source et les groupes de texte.
        </div>
      ) : (
        <>
          {/* Nombre de frames */}
          <div className="px-3 py-3 border-b border-border">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Frames proposées à la CM
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={6}
                max={72}
                step={1}
                value={config.frameCount}
                onChange={(e) => setFrameCount(parseInt(e.target.value, 10))}
                className="flex-1 accent-indigo-600"
              />
              <span className="text-xs font-medium text-foreground w-8 text-right">
                {config.frameCount}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Entre 6 et 72. 24-36 est un bon compromis.
            </p>
          </div>

          {/* Groupes de texte gardés sur la cover */}
          <div className="px-3 py-3 border-b border-border">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Texte / overlays gardés sur la cover
            </p>
            <GroupSelectList
              groups={groups}
              selectedIds={config.overlayGroupIds}
              onToggle={toggleOverlayGroup}
              emptyLabel="Aucun groupe dans ce template. Ajoute-les depuis l'onglet Calques."
            />
          </div>

          {/* Clips source des frames */}
          <div className="px-3 py-3 border-b border-border">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Clips où piocher les frames
            </p>
            {slots.length === 0 ? (
              <span className="text-[10px] text-muted-foreground italic">
                Aucun bloc vidéo dans ce template — ajoute-en un depuis Calques
                puis amorce un clip dans l&apos;onglet Séquence.
              </span>
            ) : (
              <>
                <div className="space-y-1 mb-2">
                  {(["all", "exclude", "include"] as const).map((mode) => (
                    <label key={mode} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="slot-mode"
                        checked={config.slotMode === mode}
                        onChange={() => setSlotMode(mode)}
                      />
                      <span className="text-xs text-foreground">
                        {mode === "all" && "Toute la vidéo"}
                        {mode === "exclude" && "Toute la vidéo sauf certains clips"}
                        {mode === "include" && "Uniquement certains clips"}
                      </span>
                    </label>
                  ))}
                </div>

                {config.slotMode !== "all" && (
                  <div
                    className={`space-y-1 pl-5 border-l-2 ${
                      config.slotMode === "exclude" ? "border-red-200" : "border-emerald-200"
                    }`}
                  >
                    {slots.map((slot, idx) => {
                      const checked = config.slotIds.includes(slot.id);
                      return (
                        <label key={slot.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleSlot(slot.id, e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-xs text-muted-foreground">
                            {slot.label ?? `Slot ${idx + 1}`}
                          </span>
                          {slot.maxDuration !== undefined && (
                            <span className="text-[9px] text-muted-foreground">
                              ({slot.maxDuration}s max)
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
