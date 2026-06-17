"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { useRegisterDialog } from "./useDialogStack";

/**
 * Modal de confirmation avec focus trap léger + ESC.
 *
 * Z-index dynamique via useRegisterDialog : empile au-dessus de tout Drawer
 * ou Modal déjà ouvert. ESC ne ferme QUE le top de la pile.
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
  const [mounted, setMounted] = useState(false);
  const { zIndex } = useRegisterDialog(open, onCancel);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-zinc-950/50"
        style={{ zIndex }}
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="fixed inset-0 flex items-center justify-center px-4 pointer-events-none"
        style={{ zIndex: zIndex + 1 }}
      >
        <div className="bg-card text-card-foreground border border-border shadow-lg rounded-lg w-full max-w-md pointer-events-auto overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <h2
              id="confirm-dialog-title"
              className="text-sm font-semibold text-foreground mb-1"
            >
              {title}
            </h2>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              {description}
            </p>
            {children}
          </div>
          <div className="flex items-center justify-end gap-2 px-5 py-3 bg-muted border-t border-border">
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
    </>,
    document.body,
  );
}
