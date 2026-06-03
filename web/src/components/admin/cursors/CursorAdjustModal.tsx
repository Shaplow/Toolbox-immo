"use client";

/**
 * CursorAdjustModal — permet de définir manuellement la position du curseur
 * (cursor Int pour Media, ou lastUsedCategory/SetTag pour Data).
 *
 * Ouverte depuis CursorAccountList via le bouton "Jump to…".
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";
import { RotateCw } from "lucide-react";

export type CursorRow = {
  accountId: string;
  handle: string | null;
  isShared: boolean;
  cursor?: number;
  lastUsedSetTag: string | null;
  lastUsedCategory: string | null;
  lastAdvancedAt: string | null;
};

interface Props {
  open: boolean;
  onClose: () => void;
  type: "media" | "data";
  libraryId: string;
  row: CursorRow;
  sequenceLength: number; // 0 = auto mode (no upper bound)
  onUpdated: (updated: CursorRow) => void;
}

export function CursorAdjustModal({
  open,
  onClose,
  type,
  libraryId,
  row,
  sequenceLength,
  onUpdated,
}: Props) {
  const [cursorStr, setCursorStr] = useState(String(row.cursor ?? 0));
  const [setTag, setSetTag] = useState(row.lastUsedSetTag ?? "");
  const [category, setCategory] = useState(row.lastUsedCategory ?? "");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    try {
      const body: Record<string, unknown> = {};

      if (type === "media") {
        const parsed = parseInt(cursorStr, 10);
        if (isNaN(parsed) || parsed < 0) {
          toast.error("La position doit être un entier >= 0");
          return;
        }
        body.cursor = parsed;
        body.lastUsedSetTag = setTag.trim() || null;
        body.lastUsedCategory = category.trim() || null;
      } else {
        if (setTag === undefined && category === undefined) {
          toast.error("Au moins un champ est requis");
          return;
        }
        body.lastUsedSetTag = setTag.trim() || null;
        body.lastUsedCategory = category.trim() || null;
      }

      const res = await fetch(
        `/api/admin/cursors/${type}/${libraryId}/${row.accountId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Erreur lors de la mise à jour");
        return;
      }

      const data = (await res.json()) as { cursor: CursorRow };
      onUpdated({
        ...row,
        cursor: data.cursor.cursor,
        lastUsedSetTag: data.cursor.lastUsedSetTag,
        lastUsedCategory: data.cursor.lastUsedCategory,
        lastAdvancedAt: data.cursor.lastAdvancedAt,
      });
      toast.success("Curseur mis à jour");
      onClose();
    } finally {
      setLoading(false);
    }
  }

  const accountLabel = row.isShared
    ? "Partagé (tous comptes)"
    : (row.handle ?? row.accountId);

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <Modal.Header onClose={onClose}>
        Ajuster le curseur — {accountLabel}
      </Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
          {type === "media" && (
            <FormField
              label="Position (cursor)"
              help={
                sequenceLength > 0
                  ? `Index dans setSequence (0–${sequenceLength - 1}). Sera clampé automatiquement.`
                  : "Mode auto (aucun setSequence configuré) — valeur libre."
              }
            >
              <Input
                type="number"
                value={cursorStr}
                onChange={setCursorStr}
                min={0}
                max={sequenceLength > 0 ? sequenceLength - 1 : undefined}
              />
            </FormField>
          )}

          <FormField
            label="Dernier setTag utilisé"
            help="Laissez vide pour effacer (la prochaine sélection ignorera l'exclusion par setTag)."
          >
            <Input
              value={setTag}
              onChange={setSetTag}
              placeholder="Ex: set-a"
            />
          </FormField>

          <FormField
            label="Dernière catégorie utilisée"
            help="Laissez vide pour effacer (désactive l'exclusion consécutive de catégorie)."
          >
            <Input
              value={category}
              onChange={setCategory}
              placeholder="Ex: interview"
            />
          </FormField>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Annuler
        </Button>
        <Button
          variant="primary"
          icon={RotateCw}
          loading={loading}
          onClick={() => void handleSubmit()}
        >
          Appliquer
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
