"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * DropdownMenu simple — menu d'actions au click.
 *
 * Implémentation sans dépendance externe (Floating UI, Radix). Click
 * outside et ESC ferment le menu. Focus revient au trigger à la fermeture.
 *
 * - `trigger` : élément cliquable (souvent un ButtonIcon "More").
 * - `items` : array d'actions { label, icon?, onClick?, destructive?,
 *             disabled?, kbd? } ou `"separator"` pour une ligne.
 * - `align` : "start" (default, aligne à gauche du trigger) | "end"
 *             (aligne à droite).
 */

type DropdownItem =
  | "separator"
  | {
      label: string;
      icon?: LucideIcon;
      onClick?: () => void;
      destructive?: boolean;
      disabled?: boolean;
      /** Raccourci clavier affiché à droite. Décoratif uniquement. */
      kbd?: string;
    };

interface DropdownMenuProps {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: "start" | "end";
}

export function DropdownMenu({ trigger, items, align = "start" }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
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
      {open && (
        <div
          role="menu"
          className={`absolute top-full mt-1.5 z-50 min-w-[180px] rounded-md bg-[var(--surface-glass-strong)] backdrop-blur-[20px] backdrop-saturate-150 shadow-[var(--shadow-glass-popover),var(--ring-glass-inset)] py-1 ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item, idx) => {
            if (item === "separator") {
              return <div key={`sep-${idx}`} className="my-1 h-px bg-gray-100" />;
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
                    ? "text-danger-600 hover:bg-danger-50/60 hover:text-danger-700"
                    : "text-gray-700 hover:bg-white/60 hover:text-gray-950"
                }`}
              >
                {Icon && <Icon size={14} className="shrink-0" />}
                <span className="flex-1">{item.label}</span>
                {item.kbd && (
                  <kbd className="text-[10px] font-mono text-gray-400">{item.kbd}</kbd>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
