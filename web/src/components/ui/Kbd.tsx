"use client";

import type { ReactNode } from "react";

/**
 * Raccourci clavier — pill compacte mono.
 *
 * Usage : `<Kbd>⌘</Kbd> + <Kbd>K</Kbd>` ou en groupe via le helper
 * <KbdChord keys={["⌘", "K"]} />.
 *
 * Sizes : sm (h-4 default, pour trailing dans inputs/buttons) | md (h-5).
 */
interface KbdProps {
  size?: "sm" | "md";
  children: ReactNode;
}

export function Kbd({ size = "sm", children }: KbdProps) {
  const sizeCls =
    size === "sm" ? "h-4 px-1 text-[10px]" : "h-5 px-1.5 text-[11px]";
  // Style verre Liquid Glass v2 : transparent légèrement teinté + ring
  // intérieur signature. Lit comme une touche physique posée sur la surface.
  return (
    <kbd
      className={`inline-flex items-center justify-center rounded bg-white/60 backdrop-blur-[6px] font-mono text-gray-700 shadow-[var(--ring-glass-edge),inset_0_-1px_0_rgba(15,23,42,0.06)] ${sizeCls}`}
    >
      {children}
    </kbd>
  );
}

/**
 * Raccourci composé — affiche plusieurs touches séparées par "+".
 */
export function KbdChord({
  keys,
  size = "sm",
  separator = "+",
}: {
  keys: string[];
  size?: "sm" | "md";
  separator?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="inline-flex items-center gap-1">
          <Kbd size={size}>{k}</Kbd>
          {i < keys.length - 1 && (
            <span className="text-[10px] text-gray-400">{separator}</span>
          )}
        </span>
      ))}
    </span>
  );
}
