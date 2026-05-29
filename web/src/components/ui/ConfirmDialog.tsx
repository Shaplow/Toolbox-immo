"use client";

import { useEffect, useRef } from "react";
import { Button } from "./Button";

/**
 * Modal de confirmation avec focus trap léger + ESC.
 *
 * - Overlay z-40 (sous le dialog mais au-dessus du header sticky).
 * - Dialog z-50, centré, max-w-md, rounded-xl, shadow-modal.
 * - Autofocus sur "Confirmer".
 * - Variant `danger` → bouton de confirmation rouge sémantique.
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** Contenu additionnel entre la description et les boutons (ex: textarea). */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-gray-950/40 z-40"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none"
      >
        <div className="bg-white rounded-xl shadow-[var(--shadow-modal)] w-full max-w-md pointer-events-auto overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <h2
              id="confirm-dialog-title"
              className="text-sm font-semibold text-gray-950 mb-1"
            >
              {title}
            </h2>
            <p className="text-[13px] text-gray-600 leading-relaxed">
              {description}
            </p>
            {children}
          </div>
          <div className="flex items-center justify-end gap-2 px-5 py-3 bg-gray-50 border-t border-gray-100">
            <Button
              variant="secondary"
              size="sm"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel}
            </Button>
            <Button
              ref={confirmRef}
              variant={variant === "danger" ? "danger" : "primary"}
              size="sm"
              loading={loading}
              onClick={() => {
                void onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
