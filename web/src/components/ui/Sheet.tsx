"use client";

/**
 * Sheet — bottom-anchored mobile, gauge handle visible.
 *
 * Idéal pour : feuilles d'actions mobile, sélecteurs (date, options), revue
 * d'élément en mobile-first.
 *
 * Doctrine Liquid Glass v2 :
 * - Backdrop scrim-dark + backdrop-blur 4px.
 * - Panel surface-glass-strong + shadow-glass-lg + ring inset, ancré bottom.
 * - Handle visible (la "poignée" macOS / iOS) en haut du panel.
 * - Z-index via useDialogStack.
 *
 * Variants :
 * - `auto` (default) : height = content (max 90vh).
 * - `halfHeight` : 50vh.
 * - `fullHeight` : 100vh.
 *
 * Sous-composants :
 * - <Sheet.Header onClose?> — titre + bouton fermer optionnel
 * - <Sheet.Body>            — content scrollable
 * - <Sheet.Footer>          — barre actions
 */

import { useEffect, useRef, type ReactNode } from "react";
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
  style = "default",
  dismissOnBackdrop = true,
  className,
  children,
}: SheetProps) {
  const { zIndex } = useRegisterDialog(open, onClose);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const panelCls =
    style === "solid"
      ? "bg-white shadow-[var(--shadow-modal),0_24px_64px_-16px_rgba(15,23,42,0.18)] border-t border-gray-200"
      : "bg-gradient-to-b from-white to-white/85 backdrop-blur-[24px] backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(15,23,42,0.06),0_-8px_24px_-4px_rgba(15,23,42,0.12),0_-32px_72px_-12px_rgba(15,23,42,0.22)]";

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
          "fixed bottom-0 left-0 right-0 flex flex-col rounded-t-2xl overflow-hidden focus:outline-none",
          VARIANT_CLS[variant],
          panelCls,
          className ?? "",
        ].filter(Boolean).join(" ")}
        style={{ zIndex: zIndex + 1 }}
      >
        {/* Handle macOS/iOS signature. */}
        <div className="shrink-0 flex justify-center pt-3 pb-2">
          <span className="h-1 w-9 rounded-full bg-gray-300/80" aria-hidden />
        </div>
        {children}
      </div>
    </>
  );
}

function SheetHeader({ children, onClose }: { children?: ReactNode; onClose?: () => void }) {
  return (
    <div className="shrink-0 flex items-center justify-between px-5 pb-3 border-b border-white/30">
      <h2 className="text-[15px] font-semibold tracking-tight text-gray-950">{children}</h2>
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
    <div className={["shrink-0 flex items-center justify-end gap-2 px-5 py-3 bg-white/30 border-t border-white/30", className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

Sheet.Header = SheetHeader;
Sheet.Body = SheetBody;
Sheet.Footer = SheetFooter;
