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
  // Style verre Liquid Glass v2 — touche physique macOS Sequoia : gradient
  // top blanc → soft, ring inset top blanc 90 % (highlight spéculaire),
  // edge ring discret, ombre bas marquée (relief tactile) + halo extérieur
  // diffus. Lit comme une vraie touche posée sur la surface.
  return (
    <kbd
      className={`inline-flex items-center justify-center rounded bg-gradient-to-b from-white/90 to-white/55 backdrop-blur-[10px] backdrop-saturate-150 font-mono text-gray-800 shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-1.5px_0_rgba(15,23,42,0.12),0_1px_0_rgba(15,23,42,0.05),0_2px_4px_-1px_rgba(15,23,42,0.08)] ${sizeCls}`}
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
