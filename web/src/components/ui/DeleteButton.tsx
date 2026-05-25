"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";

interface DeleteButtonProps {
  /** Label de l'élément ciblé, ex: "ce client", "cette recette" */
  itemLabel: string;
  onConfirm: () => void | Promise<void>;
  size?: "sm" | "md";
  loading?: boolean;
}

export function DeleteButton({
  itemLabel,
  onConfirm,
  size = "sm",
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
      <Button
        variant="ghost"
        size={size}
        onClick={() => setOpen(true)}
        icon={Trash2}
        className="text-gray-400 hover:text-red-600"
        title={`Supprimer ${itemLabel}`}
      >
        <span className="sr-only">Supprimer</span>
      </Button>
      <ConfirmDialog
        open={open}
        variant="danger"
        title={`Supprimer ${itemLabel} ?`}
        description="Cette action est irréversible."
        confirmLabel="Supprimer"
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
