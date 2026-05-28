"use client";

import { useEffect, useState } from "react";
import { ImageIcon, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { CoverPresetEditDialog } from "./CoverPresetEditDialog";
import { CoverPresetThumbnail } from "./CoverPresetThumbnail";
import type { TemplateJSON } from "@/types/template";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoverPresetRow = {
  id: string;
  templateId: string;
  name: string;
  sortOrder: number;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  templateId: string;
};

// ─── CoverPresetsPanel ────────────────────────────────────────────────────────

export function CoverPresetsPanel({ templateId }: Props) {
  const [presets, setPresets] = useState<CoverPresetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [template, setTemplate] = useState<TemplateJSON | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<CoverPresetRow | null>(null);

  function fetchPresets() {
    setLoading(true);
    fetch(`/api/templates/${templateId}/cover-presets`)
      .then((r) => (r.ok ? (r.json() as Promise<CoverPresetRow[]>) : []))
      .then(setPresets)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  function fetchTemplate() {
    fetch(`/api/templates/${templateId}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ jsonData: string }>) : null))
      .then((data) => {
        if (!data) return;
        try {
          setTemplate(JSON.parse(data.jsonData) as TemplateJSON);
        } catch {
          // ignore
        }
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (templateId) {
      fetchPresets();
      fetchTemplate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  function openCreate() {
    setEditingPreset(null);
    setDialogOpen(true);
  }

  function openEdit(preset: CoverPresetRow) {
    setEditingPreset(preset);
    setDialogOpen(true);
  }

  async function handleDelete(preset: CoverPresetRow) {
    setDeletingId(preset.id);
    try {
      const res = await fetch(`/api/templates/${templateId}/cover-presets/${preset.id}`, {
        method: "DELETE",
      });
      if (res.status === 204) {
        toast.success("Preset supprimé");
        fetchPresets();
      } else {
        const data = await res.json() as { error?: string; count?: number };
        toast.error(data.error ?? "Erreur lors de la suppression");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Cover automatique
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
            En général, une seule config par template suffit — la CM choisit la frame côté fiche publication.
          </p>
        </div>
        {presets.length === 0 ? (
          <Button variant="primary" size="sm" onClick={openCreate}>
            + Configurer la cover
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={openCreate}>
            + Ajouter une variante
          </Button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <p className="text-[10px] text-gray-400 italic">Chargement…</p>
      ) : presets.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="Pas encore configurée"
          description="Configure une seule fois : combien de frames extraire + quels groupes de texte garder."
          cta={{ label: "Configurer la cover", onClick: openCreate }}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {presets.map((preset) => {
            const cfg = preset.config as {
              overlayGroupIds?: unknown[];
              excludeZones?: unknown[];
              frameCount?: number;
            };
            const overlayCount = Array.isArray(cfg.overlayGroupIds) ? cfg.overlayGroupIds.length : 0;
            const excludeCount = Array.isArray(cfg.excludeZones) ? cfg.excludeZones.length : 0;
            const frameCount = typeof cfg.frameCount === "number" ? cfg.frameCount : 36;
            return (
              <div
                key={preset.id}
                className="flex items-center gap-3 px-2 py-2 rounded-lg border border-gray-100 bg-white hover:bg-gray-50 transition-colors"
              >
                {/* Mini thumbnail SVG (réutilisable depuis le dialog) */}
                {template ? (
                  <button
                    type="button"
                    onClick={() => openEdit(preset)}
                    className="shrink-0 rounded overflow-hidden hover:ring-2 hover:ring-indigo-300 transition-all"
                    title="Modifier ce preset"
                  >
                    <CoverPresetThumbnail template={template} config={preset.config} width={36} />
                  </button>
                ) : (
                  <div className="bg-gray-100 rounded shrink-0" style={{ width: 36, height: 64 }} />
                )}

                {/* Infos preset */}
                <div className="flex-1 min-w-0">
                  <button
                    type="button"
                    className="block text-left text-xs font-medium text-gray-700 hover:text-indigo-700 truncate"
                    onClick={() => openEdit(preset)}
                  >
                    {preset.name}
                    <span className="ml-1.5 text-[10px] text-gray-300 font-normal">#{preset.sortOrder}</span>
                  </button>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {frameCount} frames · {overlayCount} overlay{overlayCount > 1 ? "s" : ""}
                    {excludeCount > 0 && ` · ${excludeCount} zone${excludeCount > 1 ? "s" : ""} exclue${excludeCount > 1 ? "s" : ""}`}
                  </p>
                </div>

                {/* Actions */}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Pencil}
                  onClick={() => openEdit(preset)}
                  className="text-gray-400 hover:text-indigo-600 shrink-0"
                  title="Modifier ce preset"
                >
                  <span className="sr-only">Modifier</span>
                </Button>
                <DeleteButton
                  itemLabel={`le preset "${preset.name}"`}
                  description="Cette action est irréversible. Si des patterns référencent ce preset, la suppression sera refusée."
                  onConfirm={() => handleDelete(preset)}
                  loading={deletingId === preset.id}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit dialog */}
      <CoverPresetEditDialog
        templateId={templateId}
        preset={editingPreset}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          setDialogOpen(false);
          fetchPresets();
        }}
      />
    </>
  );
}
