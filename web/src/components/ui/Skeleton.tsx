"use client";

/**
 * Loading placeholder — pulse simple bg-muted.
 *
 * Variants : line (default), block (carré configurable), circle (avatars).
 * Toujours dimensionner explicitement (w/h ou aspect) pour éviter le layout shift.
 */

interface SkeletonProps {
  /** Largeur Tailwind (ex: "w-32", "w-full"). */
  className?: string;
  /** "line" (default), "block", "circle". */
  shape?: "line" | "block" | "circle";
}

export function Skeleton({ className, shape = "line" }: SkeletonProps) {
  const base = "animate-pulse bg-muted";
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

/** Composé pratique : avatar + 2 lignes (titre + sous-titre). */
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
