"use client";

/**
 * Drawer — panel ancré sur un bord (v3 big bang DA flat shadcn 2026-06-15).
 *
 * - Backdrop scrim zinc-950 @ 50% (solid).
 * - Panel = bg-card + border zinc-200 + shadow-lg + rounded selon side.
 * - Sides : right (default) | left | bottom.
 * - Sizes : sm (320) | md (448, default) | lg (640) | xl (768) | full.
 * - Z-index via useDialogStack.
 *
 * Sous-composants :
 * - <Drawer.Header onClose?> — titre + bouton fermer
 * - <Drawer.Body scrollable?> — content (par défaut scrollable y)
 * - <Drawer.Footer>          — barre actions
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  /** @deprecated v3 — toujours flat solid désormais. Conservé pour compat. */
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
  sm:   "h-[33vh]",
  md:   "h-[50vh]",
  lg:   "h-[66vh]",
  xl:   "h-[75vh]",
  full: "h-screen",
};

export function Drawer({
  open,
  onClose,
  side = "right",
  size = "md",
  dismissOnBackdrop = true,
  className,
  children,
}: DrawerProps) {
  const { zIndex } = useRegisterDialog(open, onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!open || !mounted) return null;

  const panelCls = "bg-card text-card-foreground border border-border shadow-lg";

  // Positionnement + sizing + radius selon le side.
  // h-screen (100vh) au lieu de h-full (100%) : robustesse vis-à-vis du
  // containing block ancêtre.
  const positionCls = {
    right:  `fixed top-0 right-0 h-screen ${SIZE_PX[size]} rounded-l-2xl`,
    left:   `fixed top-0 left-0 h-screen ${SIZE_PX[size]} rounded-r-2xl`,
    bottom: `fixed bottom-0 left-0 right-0 ${SIZE_PX_BOTTOM[size]} rounded-t-2xl`,
  }[side];

  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-zinc-950/50"
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
    </>,
    document.body,
  );
}

function DrawerHeader({ children, onClose }: { children?: ReactNode; onClose?: () => void }) {
  return (
    <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-border">
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{children}</h2>
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
    <div className={["shrink-0 flex items-center justify-end gap-2 px-5 py-3 bg-muted/40 border-t border-border", className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

Drawer.Header = DrawerHeader;
Drawer.Body = DrawerBody;
Drawer.Footer = DrawerFooter;
