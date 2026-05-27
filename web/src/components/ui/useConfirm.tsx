"use client";

import { useCallback, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
};

type PendingState = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

/**
 * Hook pour remplacer `window.confirm()` par un `ConfirmDialog` stylé.
 *
 * Renvoie une fonction `confirm()` qui retourne une promesse (true = confirmé,
 * false = annulé) et le JSX `dialog` à rendre dans le composant.
 *
 * Usage :
 * ```tsx
 * const { confirm, dialog } = useConfirm();
 * async function handleDelete() {
 *   const ok = await confirm({
 *     title: "Supprimer ?",
 *     description: "Action irréversible.",
 *     variant: "danger",
 *   });
 *   if (!ok) return;
 *   await doDelete();
 * }
 * return <>{...} {dialog}</>;
 * ```
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingState | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    pending?.resolve(true);
    setPending(null);
  }, [pending]);

  const handleCancel = useCallback(() => {
    pending?.resolve(false);
    setPending(null);
  }, [pending]);

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ""}
      description={pending?.description ?? ""}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      variant={pending?.variant}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { confirm, dialog };
}
