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
  return (
    <kbd
      className={`inline-flex items-center justify-center rounded border border-gray-300 bg-white font-mono text-gray-700 ${sizeCls}`}
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
