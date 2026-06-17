"use client";

import type { ReactNode } from "react";

/**
 * Raccourci clavier — pill compacte mono flat shadcn.
 *
 * Usage : `<Kbd>⌘</Kbd> + <Kbd>K</Kbd>` ou via `<KbdChord keys={["⌘", "K"]} />`.
 * Sizes : sm (default, trailing dans inputs/buttons) | md.
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
      className={`inline-flex items-center justify-center rounded bg-muted text-foreground border border-border font-mono ${sizeCls}`}
    >
      {children}
    </kbd>
  );
}

/** Raccourci composé — affiche plusieurs touches séparées par "+". */
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
            <span className="text-[10px] text-muted-foreground">{separator}</span>
          )}
        </span>
      ))}
    </span>
  );
}
