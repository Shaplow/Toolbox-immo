"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, POPOVER_Z_INDEX } from "@/components/ui/useAnchoredPosition";
import type { LucideIcon } from "lucide-react";

/**
 * DropdownMenu simple — menu d'actions au click.
 *
 * Implémentation sans dépendance externe. Click outside et ESC ferment le menu.
 * Items : { label, icon?, onClick?, destructive?, disabled?, kbd? } ou "separator".
 */

type DropdownItem =
  | "separator"
  | {
      label: string;
      icon?: LucideIcon;
      onClick?: () => void;
      destructive?: boolean;
      disabled?: boolean;
      kbd?: string;
    };

interface DropdownMenuProps {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: "start" | "end";
  side?: "bottom" | "top";
}

export function DropdownMenu({ trigger, items, align = "start", side = "bottom" }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Menu portalé : sinon coupé par le premier ancêtre en overflow-hidden.
  const { position, ready } = useAnchoredPosition(open, containerRef, {
    maxHeight: 320,
    preferTop: side === "top",
    align,
    popoverRef: menuRef,
  });

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (!containerRef.current?.contains(target)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {ready && position &&
        createPortal(
        <div
          ref={menuRef}
          role="menu"
          // Le hook a déjà appliqué l'alignement et le recadrage viewport.
          style={{
            position: "absolute",
            top: position.top,
            left: position.left,
            zIndex: POPOVER_Z_INDEX,
          }}
          // max-h aligné sur le `maxHeight` que le hook de positionnement
          // suppose déjà : sans overflow, un menu de vingt items débordait de
          // l'écran et ses derniers items devenaient inatteignables.
          className="min-w-[180px] max-h-[320px] overflow-y-auto rounded-md bg-popover text-popover-foreground border border-border shadow-lg py-1"
        >
          {items.map((item, idx) => {
            if (item === "separator") {
              return <div key={`sep-${idx}`} className="my-1 h-px bg-border" />;
            }
            const Icon = item.icon;
            return (
              <button
                key={`${item.label}-${idx}`}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  item.onClick?.();
                  setOpen(false);
                }}
                className={`w-full inline-flex items-center gap-2 px-3 py-1.5 text-[13px] text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  item.destructive
                    ? "text-danger-600 hover:bg-danger-50 hover:text-danger-700"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {Icon && <Icon size={14} className="shrink-0" />}
                <span className="flex-1">{item.label}</span>
                {item.kbd && (
                  <kbd className="text-[10px] font-mono text-muted-foreground">{item.kbd}</kbd>
                )}
              </button>
            );
          })}
        </div>,
          document.body,
        )}
    </div>
  );
}
