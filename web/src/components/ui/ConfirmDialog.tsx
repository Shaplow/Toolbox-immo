"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { useRegisterDialog } from "./useDialogStack";

/**
 * Modal de confirmation avec focus trap léger + ESC.
 *
 * Z-index dynamique via useRegisterDialog : le ConfirmDialog s'empile au-dessus
 * de tout autre dialogue (Drawer, Modal) déjà ouvert. Sans ça, un confirm
 * déclenché depuis un Drawer apparaissait DERRIÈRE le Drawer (z-40/z-50
 * statiques inférieurs au Drawer stacké à z-60+).
 *
 * - Autofocus sur "Confirmer".
 * - Variant `danger` → bouton de confirmation rouge sémantique.
 * - ESC géré par le hook (ne ferme QUE le dialog au sommet de la pile).
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
  // Stack dynamique : ce dialog passe au-dessus de tout Drawer/Modal déjà ouvert.
  // ESC géré par le hook (ne ferme que le top de la pile).
  const { zIndex } = useRegisterDialog(open, onCancel);

  useEffect(() => {
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
        className="fixed inset-0 backdrop-blur-[12px] backdrop-saturate-110"
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
        <div className="bg-gradient-to-b from-white to-white/85 backdrop-blur-[24px] backdrop-saturate-150 rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(15,23,42,0.06),0_8px_24px_-4px_rgba(15,23,42,0.12),0_32px_72px_-12px_rgba(15,23,42,0.22)] w-full max-w-md pointer-events-auto overflow-hidden">
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
          <div className="flex items-center justify-end gap-2 px-5 py-3 bg-white/40 border-t border-white/40">
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
