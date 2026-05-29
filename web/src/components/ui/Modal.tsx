"use client";

/**
 * Modal — dialogue centré, focus-trap, ESC, click-backdrop, body scroll lock.
 *
 * Doctrine Liquid Glass v2 :
 * - Backdrop = scrim-dark + backdrop-blur 4px (cohérent ConfirmDialog).
 * - Panel default = surface-glass-strong + shadow-glass-lg + ring inset.
 * - Variant `default` (glass) ou `solid` (white + shadow-modal) au choix.
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

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { ButtonIcon } from "./ButtonIcon";
import { useRegisterDialog } from "./useDialogStack";

type Size = "sm" | "md" | "lg" | "xl" | "full";
type Variant = "default" | "solid";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  size?: Size;
  variant?: Variant;
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
  variant = "default",
  dismissOnBackdrop = true,
  className,
  children,
}: ModalProps) {
  const { zIndex } = useRegisterDialog(open, onClose);
  const panelRef = useRef<HTMLDivElement>(null);

  // Auto-focus panel à l'ouverture (focus-trap basique).
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const panelCls =
    variant === "solid"
      ? "bg-white shadow-[var(--shadow-modal)] border border-gray-200"
      : "bg-[var(--surface-glass-strong)] backdrop-blur-[24px] backdrop-saturate-150 shadow-[var(--shadow-glass-lg),var(--ring-glass-inset)]";

  return (
    <>
      <div
        className="fixed inset-0 bg-[var(--scrim-dark)] backdrop-blur-[4px]"
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
    </>
  );
}

function ModalHeader({ children, onClose }: { children?: ReactNode; onClose?: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-white/30">
      <h2 className="text-[15px] font-semibold tracking-tight text-gray-950">{children}</h2>
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
    <div className={["flex items-center justify-end gap-2 px-5 py-3 bg-white/30 border-t border-white/30", className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

Modal.Header = ModalHeader;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
