"use client";

import { useEffect, useRef } from "react";
import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** Contenu additionnel rendu entre la description et les boutons (ex: textarea). */
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

  // Autofocus sur "Confirmer" à l'ouverture + ESC pour fermer
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
      {/* Overlay — z-40 pour rester sous le dialog mais au-dessus du header sticky */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onCancel}
        aria-hidden="true"
      />
      {/* Dialog — z-50 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="fixed inset-0 z-50 flex items-center justify-center px-4 pointer-events-none"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md pointer-events-auto overflow-hidden">
          <div className="px-6 pt-6 pb-3">
            <h2
              id="confirm-dialog-title"
              className="text-base font-semibold text-gray-900 mb-1"
            >
              {title}
            </h2>
            <p className="text-sm text-gray-600">{description}</p>
            {children}
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-4 bg-gray-50 border-t border-gray-100">
            <Button
              variant="secondary"
              size="md"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel}
            </Button>
            <Button
              ref={confirmRef}
              variant={variant === "danger" ? "danger" : "primary"}
              size="md"
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
