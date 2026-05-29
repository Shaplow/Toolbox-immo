"use client";

/**
 * SoftPanel — wrapper "page intérieure" pour les pages d'édition longues.
 *
 * Layout : header sticky + content scrollable + toolbar bottom optionnel.
 *
 * Use cases : admin/libraries/media/[id], builder, captions/edit, fiche
 * de preset/template editor — toute page qui consiste en une zone
 * d'édition longue qui doit garder son header visible au scroll.
 *
 * Doctrine Liquid Glass v2 :
 * - Container rounded-2xl + surface-glass-strong + ring inset.
 * - Header sticky top-0 dans le panel + bordure inférieure subtle.
 * - Content padded + max-h-[calc(...)] avec overflow-y-auto.
 * - Toolbar bottom : border-top subtle + actions à droite.
 *
 * API :
 *
 *   <SoftPanel
 *     header={<>
 *       <Breadcrumb ... />
 *       <h1>Édition du preset</h1>
 *     </>}
 *     toolbar={<>
 *       <Button variant="secondary">Annuler</Button>
 *       <Button>Enregistrer</Button>
 *     </>}
 *     maxHeight="calc(100vh - 8rem)"
 *   >
 *     ...content...
 *   </SoftPanel>
 */

import type { ReactNode } from "react";

interface SoftPanelProps {
  /** Contenu du header sticky. */
  header: ReactNode;
  /** Contenu principal scrollable. */
  children: ReactNode;
  /** Actions/boutons du footer optionnel (alignés à droite par défaut). */
  toolbar?: ReactNode;
  /** Justify content du toolbar. Default "end". */
  toolbarJustify?: "start" | "between" | "end";
  /** Max height du panel. Si fourni, scroll interne. */
  maxHeight?: string;
  /** Largeur max du content. Default "none" (full width). */
  maxWidth?: string;
  /** Padding du content body. Default true. */
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
        "flex flex-col rounded-2xl overflow-hidden",
        "bg-[var(--surface-glass-strong)] backdrop-blur-[24px] backdrop-saturate-150",
        "shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(15,23,42,0.06),0_2px_8px_-2px_rgba(15,23,42,0.08)]",
        className ?? "",
      ].join(" ")}
      style={maxHeight ? { maxHeight } : undefined}
    >
      {/* Header sticky */}
      <header className="shrink-0 sticky top-0 z-10 px-5 py-3.5 border-b border-white/40 bg-gradient-to-b from-white/85 to-white/65 backdrop-blur-[12px]">
        {header}
      </header>

      {/* Body */}
      <div
        className={[
          "flex-1 overflow-y-auto",
          padded ? "px-5 py-4" : "",
        ].filter(Boolean).join(" ")}
        style={maxWidth ? { maxWidth } : undefined}
      >
        {children}
      </div>

      {/* Toolbar (optional) */}
      {toolbar && (
        <footer
          className={[
            "shrink-0 flex items-center gap-2 px-5 py-3 border-t border-white/40 bg-white/30 backdrop-blur-[12px]",
            TOOLBAR_JUSTIFY[toolbarJustify],
          ].join(" ")}
        >
          {toolbar}
        </footer>
      )}
    </div>
  );
}
