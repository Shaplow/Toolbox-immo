"use client";

/**
 * Drawer — panel ancré sur un bord. Idéal pour édition de slots, navigation
 * secondaire, filtres compacts.
 *
 * Doctrine Liquid Glass v2 :
 * - Backdrop scrim-dark + backdrop-blur 4px.
 * - Panel surface-glass-strong + shadow-glass-lg + ring inset (default)
 *   ou solid white + shadow-modal.
 * - Slide animation respect du `--ease-out-soft` + `--duration-slow`.
 * - Z-index via useDialogStack.
 *
 * Sides : right (default, panel droite) | left | bottom.
 * Sizes : sm (320) | md (448, default) | lg (640) | xl (768) | full.
 *
 * Sous-composants :
 * - <Drawer.Header onClose?> — titre + bouton fermer
 * - <Drawer.Body scrollable?> — content (par défaut scrollable y)
 * - <Drawer.Footer>          — barre actions
 */

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { ButtonIcon } from "./ButtonIcon";
import { useRegisterDialog } from "./useDialogStack";

type Side = "right" | "left" | "bottom";
type Size = "sm" | "md" | "lg" | "xl" | "full";
type Variant = "default" | "solid";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: Side;
  size?: Size;
  variant?: Variant;
  dismissOnBackdrop?: boolean;
  className?: string;
  children?: ReactNode;
}

const SIZE_PX: Record<Size, string> = {
  sm:   "w-80 max-w-full",
  md:   "w-[28rem] max-w-full",
  lg:   "w-[40rem] max-w-full",
  xl:   "w-[48rem] max-w-full",
  full: "w-full",
};

const SIZE_PX_BOTTOM: Record<Size, string> = {
  sm:   "h-1/3",
  md:   "h-1/2",
  lg:   "h-2/3",
  xl:   "h-3/4",
  full: "h-full",
};

export function Drawer({
  open,
  onClose,
  side = "right",
  size = "md",
  variant = "default",
  dismissOnBackdrop = true,
  className,
  children,
}: DrawerProps) {
  const { zIndex } = useRegisterDialog(open, onClose);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const panelCls =
    variant === "solid"
      ? "bg-white shadow-[var(--shadow-modal),0_24px_64px_-16px_rgba(15,23,42,0.18)] border border-gray-200"
      : "bg-gradient-to-b from-white to-white/85 backdrop-blur-[24px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(15,23,42,0.06),0_8px_24px_-4px_rgba(15,23,42,0.12),0_32px_72px_-12px_rgba(15,23,42,0.22)]";

  // Positionnement + sizing + radius selon le side.
  const positionCls = {
    right:  `fixed top-0 right-0 h-full ${SIZE_PX[size]} rounded-l-2xl`,
    left:   `fixed top-0 left-0 h-full ${SIZE_PX[size]} rounded-r-2xl`,
    bottom: `fixed bottom-0 left-0 right-0 ${SIZE_PX_BOTTOM[size]} rounded-t-2xl`,
  }[side];

  return (
    <>
      <div
        className="fixed inset-0 backdrop-blur-[12px] backdrop-saturate-110"
        style={{ zIndex }}
        onClick={dismissOnBackdrop ? onClose : undefined}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={[
          positionCls,
          "flex flex-col overflow-hidden focus:outline-none",
          panelCls,
          className ?? "",
        ].filter(Boolean).join(" ")}
        style={{ zIndex: zIndex + 1 }}
      >
        {children}
      </div>
    </>
  );
}

function DrawerHeader({ children, onClose }: { children?: ReactNode; onClose?: () => void }) {
  return (
    <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/30">
      <h2 className="text-[15px] font-semibold tracking-tight text-gray-950">{children}</h2>
      {onClose && (
        <ButtonIcon icon={X} label="Fermer" variant="ghost" size="sm" onClick={onClose} />
      )}
    </div>
  );
}

function DrawerBody({ children, className, scrollable = true }: { children: ReactNode; className?: string; scrollable?: boolean }) {
  return (
    <div
      className={[
        "flex-1 px-5 py-4",
        scrollable ? "overflow-y-auto" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}

function DrawerFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={["shrink-0 flex items-center justify-end gap-2 px-5 py-3 bg-white/30 border-t border-white/30", className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

Drawer.Header = DrawerHeader;
Drawer.Body = DrawerBody;
Drawer.Footer = DrawerFooter;
