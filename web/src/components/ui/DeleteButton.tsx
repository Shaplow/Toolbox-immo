"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { ButtonIcon } from "./ButtonIcon";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Bouton de suppression — icône Trash + ConfirmDialog danger.
 *
 * Pattern courant pour les suppressions inline (rows hover, toolbars).
 * Utilise ButtonIcon variant="danger" qui devient rouge au hover.
 */
interface DeleteButtonProps {
  /** Label de l'élément ciblé, ex: "ce client", "cette recette" */
  itemLabel: string;
  description?: string;
  onConfirm: () => void | Promise<void>;
  size?: "sm" | "md";
  loading?: boolean;
}

export function DeleteButton({
  itemLabel,
  description = "Cette action est irréversible.",
  onConfirm,
  size = "md",
  loading = false,
}: DeleteButtonProps) {
  const [open, setOpen] = useState(false);

  async function handleConfirm() {
    try {
      await onConfirm();
    } finally {
      setOpen(false);
    }
  }

  return (
    <>
      <ButtonIcon
        icon={Trash2}
        label={`Supprimer ${itemLabel}`}
        variant="danger"
        size={size}
        onClick={() => setOpen(true)}
      />
      <ConfirmDialog
        open={open}
        variant="danger"
        title={`Supprimer ${itemLabel} ?`}
        description={description}
        confirmLabel="Supprimer"
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
