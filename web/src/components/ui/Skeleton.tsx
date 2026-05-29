"use client";

/**
 * Loading placeholder — pulse subtil sur wash gradient aurora léger
 * (Liquid Glass v2). Donne plus de matière qu'un pulse gray-100 plat.
 *
 * Variants de shape : line (default, hauteur configurable), block (carré
 * avec ratio configurable), circle (pour avatars).
 *
 * À utiliser pour les états de chargement de surfaces complètes ou
 * d'éléments précis (avatar, ligne de texte, image). Toujours
 * dimensionner explicitement (w/h ou aspect) pour éviter le layout shift.
 */

interface SkeletonProps {
  /** Largeur Tailwind (ex: "w-32", "w-full"). */
  className?: string;
  /** "line" (default), "block", "circle". */
  shape?: "line" | "block" | "circle";
}

export function Skeleton({ className, shape = "line" }: SkeletonProps) {
  // Aurora léger : gradient peach-soft → sage-soft → sky-soft à très basse
  // opacité (1-2%), invisible à l'œil sans le pulse, mais qui donne une
  // matière chaleureuse pendant l'animation. Combo avec `animate-pulse`
  // (Tailwind default opacity 1↔0.5) pour effet shimmer signature.
  const base =
    "animate-pulse bg-gray-100 bg-[linear-gradient(120deg,rgba(255,230,208,0.18),rgba(220,238,224,0.12)_50%,rgba(212,232,243,0.18))]";
  const shapeCls = {
    line:   "h-3 rounded-sm",
    block:  "rounded-md",
    circle: "rounded-full",
  }[shape];

  return (
    <span
      aria-hidden
      className={[base, shapeCls, className ?? ""].filter(Boolean).join(" ")}
    />
  );
}

/**
 * Composé pratique : un avatar + 2 lignes (titre + sous-titre).
 * Pattern courant pour les rows de listes en chargement.
 */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton shape="circle" className="h-8 w-8 shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="w-1/3" />
        <Skeleton className="w-1/2" />
      </div>
    </div>
  );
}
