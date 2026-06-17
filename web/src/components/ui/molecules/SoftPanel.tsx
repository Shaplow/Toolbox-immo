"use client";

/**
 * SoftPanel — wrapper "page intérieure" pour les pages d'édition longues.
 *
 * Layout : header sticky + content scrollable + toolbar bottom optionnel.
 * Flat shadcn : bg-card border-border. Header bg-card avec border-b.
 *
 * API :
 *   <SoftPanel
 *     header={<>...</>}
 *     toolbar={<>...</>}
 *     maxHeight="calc(100vh - 8rem)"
 *   >
 *     ...content...
 *   </SoftPanel>
 */

import type { ReactNode } from "react";

interface SoftPanelProps {
  header: ReactNode;
  children: ReactNode;
  toolbar?: ReactNode;
  toolbarJustify?: "start" | "between" | "end";
  maxHeight?: string;
  maxWidth?: string;
  padded?: boolean;
  className?: string;
}

const TOOLBAR_JUSTIFY = {
  start:   "justify-start",
  between: "justify-between",
  end:     "justify-end",
};

export function SoftPanel({
  header,
  children,
  toolbar,
  toolbarJustify = "end",
  maxHeight,
  maxWidth,
  padded = true,
  className,
}: SoftPanelProps) {
  return (
    <div
      className={[
        "flex flex-col rounded-lg overflow-hidden bg-card text-card-foreground border border-border",
        className ?? "",
      ].join(" ")}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <header className="shrink-0 sticky top-0 z-10 px-5 py-3.5 border-b border-border bg-card">
        {header}
      </header>

      <div
        className={[
          "flex-1 overflow-y-auto",
          padded ? "px-5 py-4" : "",
        ].filter(Boolean).join(" ")}
        style={maxWidth ? { maxWidth } : undefined}
      >
        {children}
      </div>

      {toolbar && (
        <footer
          className={[
            "shrink-0 flex items-center gap-2 px-5 py-3 border-t border-border bg-muted",
            TOOLBAR_JUSTIFY[toolbarJustify],
          ].join(" ")}
        >
          {toolbar}
        </footer>
      )}
    </div>
  );
}
