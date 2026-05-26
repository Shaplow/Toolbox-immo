"use client";

import { useEffect, useState } from "react";
import { ImageIcon, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import { CoverPresetEditDialog } from "./CoverPresetEditDialog";

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

  useEffect(() => {
    if (templateId) fetchPresets();
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
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {presets.length > 0
            ? `${presets.length} preset${presets.length > 1 ? "s" : ""} cover`
            : "Presets cover"}
        </p>
        <Button variant="primary" size="sm" onClick={openCreate}>
          + Ajouter preset
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <p className="text-[10px] text-gray-400 italic">Chargement…</p>
      ) : presets.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="Aucun preset cover"
          description="Crée-en un pour configurer la cover automatique des patterns."
          cta={{ label: "Ajouter un preset", onClick: openCreate }}
        />
      ) : (
        <div className="flex flex-col gap-1">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-gray-100 bg-white hover:bg-gray-50 transition-colors"
            >
              {/* Sort order */}
              <span className="text-[10px] text-gray-300 w-5 text-center shrink-0">
                {preset.sortOrder}
              </span>

              {/* Name — click to edit */}
              <button
                type="button"
                className="flex-1 text-left text-xs font-medium text-gray-700 hover:text-indigo-700 truncate"
                onClick={() => openEdit(preset)}
              >
                {preset.name}
              </button>

              {/* Config summary */}
              <span className="text-[10px] text-gray-400 shrink-0">
                {Array.isArray((preset.config as { overlayGroupIds?: unknown[] }).overlayGroupIds)
                  ? `${(preset.config as { overlayGroupIds: unknown[] }).overlayGroupIds.length} overlay(s)`
                  : "—"}
              </span>

              {/* Edit */}
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

              {/* Delete */}
              <DeleteButton
                itemLabel={`le preset "${preset.name}"`}
                description={
                  `Cette action est irréversible. Si des patterns référencent ce preset, la suppression sera refusée.`
                }
                onConfirm={() => handleDelete(preset)}
                loading={deletingId === preset.id}
              />
            </div>
          ))}
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
