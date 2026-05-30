"use client";

/**
 * MediaAssetsBulkSortDrawer — bottom-sheet pour bulk-assigner une Catégorie
 * à des assets orphelins (category === null).
 *
 * Phase 2 médiathèque (2026-05-30) : la 1ère brique de l'expérience noob.
 * L'user drop des fichiers, le ribbon "X fichiers à ranger" apparaît, click
 * sur le ribbon ouvre ce drawer, 1 décision (la Catégorie) → tout est rangé.
 *
 * Le Combobox autorise la création d'une nouvelle catégorie (allowCustom) +
 * propose les catégories existantes en autocomplete. Au save, PATCH bulk
 * sur l'endpoint existant (zéro changement backend).
 */

import { useMemo, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Combobox } from "@/components/ui/Combobox";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { FolderOpen } from "lucide-react";
import type { MediaAsset } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  libraryId: string;
  orphanAssets: MediaAsset[];
  /** Catégories existantes pour autocomplete (depuis les autres assets de la lib). */
  existingCategories: string[];
  onApplied: () => void | Promise<void>;
}

export function MediaAssetsBulkSortDrawer({
  open,
  onClose,
  libraryId,
  orphanAssets,
  existingCategories,
  onApplied,
}: Props) {
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);

  const options = useMemo(
    () =>
      existingCategories.map((c) => ({
        value: c,
        label: c,
        icon: FolderOpen,
      })),
    [existingCategories],
  );

  async function handleApply() {
    const trimmed = category.trim();
    if (!trimmed || orphanAssets.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/libraries/media/${libraryId}/assets/bulk`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetIds: orphanAssets.map((a) => a.id),
          category: trimmed,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(d.error ?? "Erreur lors du rangement");
        return;
      }
      const n = orphanAssets.length;
      toast.success(
        `${n} fichier${n > 1 ? "s" : ""} rangé${n > 1 ? "s" : ""} dans « ${trimmed} »`,
      );
      await onApplied();
      setCategory("");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} side="bottom" size="sm">
      <Drawer.Header onClose={onClose}>
        Ranger {orphanAssets.length} fichier{orphanAssets.length > 1 ? "s" : ""}
      </Drawer.Header>
      <Drawer.Body>
        <div className="rounded-2xl bg-gradient-to-b from-white/85 to-white/55 backdrop-blur-[8px] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(15,23,42,0.06),0_2px_8px_-4px_rgba(15,23,42,0.06)] space-y-3">
          <p className="text-[12.5px] text-gray-600 leading-relaxed">
            Choisissez une <b>catégorie</b> pour ces fichiers. Vous pouvez en
            créer une nouvelle ou réutiliser une existante.
          </p>
          <Combobox
            value={category}
            onChange={setCategory}
            options={options}
            allowCustom={true}
            placeholder="Choisir ou créer une catégorie…"
            emptyMessage="Aucune catégorie. Tapez un nom pour en créer une."
          />
          {orphanAssets.length > 0 && (
            <details className="text-[11px] text-gray-500 rounded-xl bg-white/40 backdrop-blur-[6px] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_1px_rgba(15,23,42,0.05)]">
              <summary className="cursor-pointer hover:text-gray-700 select-none">
                {orphanAssets.length} fichier{orphanAssets.length > 1 ? "s" : ""} concerné{orphanAssets.length > 1 ? "s" : ""}
              </summary>
              <ul className="mt-2 space-y-0.5 max-h-32 overflow-y-auto pr-2">
                {orphanAssets.map((a) => (
                  <li key={a.id} className="truncate" title={a.filename}>
                    · {a.filename}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Drawer.Body>
      <Drawer.Footer>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Annuler
        </Button>
        <Button
          variant="primary"
          onClick={handleApply}
          loading={saving}
          disabled={!category.trim()}
        >
          Ranger
        </Button>
      </Drawer.Footer>
    </Drawer>
  );
}
