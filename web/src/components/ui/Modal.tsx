"use client";

/**
 * Modal — dialogue centré (v3 big bang DA flat shadcn 2026-06-15).
 *
 * - Backdrop = scrim zinc-950 @ 50% (solid, plus de backdrop-blur).
 * - Panel = bg-card + border zinc-200 + shadow-lg + rounded-xl.
 * - Variant default et solid produisent maintenant le même rendu (l'ancien
 *   `default` glass est mappé en solid pour rétrocompat).
 * - Z-index via useDialogStack — gère l'empilement avec Drawer / Sheet /
 *   ConfirmDialog sans collision.
 *
 * Sous-composants :
 * - <Modal.Header onClose?> — titre + bouton fermer optionnel
 * - <Modal.Body>            — content padded
 * - <Modal.Footer>          — barre actions alignée à droite
 *
 * Sizes : sm (384) | md (448, default) | lg (672) | xl (896) | full (viewport).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ButtonIcon } from "./ButtonIcon";
import { useRegisterDialog } from "./useDialogStack";

type Size = "sm" | "md" | "lg" | "xl" | "full";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  size?: Size;
  /** Désactive la fermeture au click sur le backdrop. */
  dismissOnBackdrop?: boolean;
  className?: string;
  children?: ReactNode;
}

const SIZE_CLS: Record<Size, string> = {
  sm:   "max-w-sm",
  md:   "max-w-md",
  lg:   "max-w-2xl",
  xl:   "max-w-4xl",
  full: "max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]",
};

export function Modal({
  open,
  onClose,
  size = "md",
  dismissOnBackdrop = true,
  className,
  children,
}: ModalProps) {
  const { zIndex } = useRegisterDialog(open, onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!open || !mounted) return null;

  const panelCls = "bg-card text-card-foreground border border-border shadow-lg";

  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-zinc-950/50"
        style={{ zIndex }}
        onClick={dismissOnBackdrop ? onClose : undefined}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 flex items-center justify-center px-4 pointer-events-none"
        style={{ zIndex: zIndex + 1 }}
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          className={[
            "pointer-events-auto w-full rounded-xl overflow-hidden focus:outline-none",
            SIZE_CLS[size],
            panelCls,
            className ?? "",
          ].filter(Boolean).join(" ")}
        >
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}

function ModalHeader({ children, onClose }: { children?: ReactNode; onClose?: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{children}</h2>
      {onClose && (
        <ButtonIcon icon={X} label="Fermer" variant="ghost" size="sm" onClick={onClose} />
      )}
    </div>
  );
}

function ModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["px-5 py-4", className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}

function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={["flex items-center justify-end gap-2 px-5 py-3 bg-muted/40 border-t border-border", className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

Modal.Header = ModalHeader;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
