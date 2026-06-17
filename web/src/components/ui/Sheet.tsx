"use client";

/**
 * Sheet — bottom-anchored mobile, handle visible.
 *
 * Idéal pour : feuilles d'actions mobile, sélecteurs, revue mobile-first.
 *
 * Scrim solid zinc-950/50. Panel flat bg-card border-border shadow-lg.
 * Variants : auto (max 90vh) | halfHeight (50vh) | fullHeight (100vh).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ButtonIcon } from "./ButtonIcon";
import { useRegisterDialog } from "./useDialogStack";

type Variant = "auto" | "halfHeight" | "fullHeight";
type Style = "default" | "solid";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  variant?: Variant;
  style?: Style;
  dismissOnBackdrop?: boolean;
  className?: string;
  children?: ReactNode;
}

const VARIANT_CLS: Record<Variant, string> = {
  auto:       "max-h-[90vh]",
  halfHeight: "h-[50vh]",
  fullHeight: "h-screen rounded-none",
};

export function Sheet({
  open,
  onClose,
  variant = "auto",
  style: _style = "default",
  dismissOnBackdrop = true,
  className,
  children,
}: SheetProps) {
  void _style;
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
          "fixed bottom-0 left-0 right-0 flex flex-col rounded-t-lg overflow-hidden focus:outline-none bg-card text-card-foreground border-t border-border shadow-lg",
          VARIANT_CLS[variant],
          className ?? "",
        ].filter(Boolean).join(" ")}
        style={{ zIndex: zIndex + 1 }}
      >
        <div className="shrink-0 flex justify-center pt-3 pb-2">
          <span className="h-1 w-9 rounded-full bg-zinc-300" aria-hidden />
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}

function SheetHeader({ children, onClose }: { children?: ReactNode; onClose?: () => void }) {
  return (
    <div className="shrink-0 flex items-center justify-between px-5 pb-3 border-b border-border">
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{children}</h2>
      {onClose && (
        <ButtonIcon icon={X} label="Fermer" variant="ghost" size="sm" onClick={onClose} />
      )}
    </div>
  );
}

function SheetBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={["flex-1 px-5 py-4 overflow-y-auto", className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

function SheetFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={["shrink-0 flex items-center justify-end gap-2 px-5 py-3 bg-muted border-t border-border", className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

Sheet.Header = SheetHeader;
Sheet.Body = SheetBody;
Sheet.Footer = SheetFooter;
