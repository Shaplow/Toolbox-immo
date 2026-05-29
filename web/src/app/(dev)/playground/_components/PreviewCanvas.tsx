import type { ReactNode } from "react";

type PreviewCanvasProps = {
  children: ReactNode;
  /** Hauteur minimale du canvas (utile pour centrer une démo). */
  minH?: string;
  /** Aligner verticalement le contenu. */
  align?: "center" | "start";
  /** Padding du canvas. */
  padding?: "default" | "tight" | "loose";
  /** Fond — grid (subtle dotted), plain (uniforme gray-50), light (gray-50/40). */
  bg?: "grid" | "plain" | "light";
  className?: string;
};

const PADDINGS = {
  tight: "p-4",
  default: "p-8 sm:p-10",
  loose: "p-12 sm:p-16",
};

const BGS = {
  grid: "bg-gray-50",
  plain: "bg-gray-50",
  light: "bg-gray-50/50",
};

/**
 * Bloc preview neutre pour mettre en scène une démo de composant.
 * Fond gris doux, bordure subtile, contenu centré par défaut.
 */
export function PreviewCanvas({
  children,
  minH = "min-h-[160px]",
  align = "center",
  padding = "default",
  bg = "grid",
  className,
}: PreviewCanvasProps) {
  const justify = align === "center" ? "items-center justify-center" : "items-start justify-start";
  const gridPattern =
    bg === "grid"
      ? "[background-image:radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.045)_1px,transparent_0)] [background-size:16px_16px]"
      : "";
  return (
    <div
      className={[
        "relative overflow-hidden rounded-lg border border-gray-200/80",
        BGS[bg],
        gridPattern,
        PADDINGS[padding],
        minH,
        "flex flex-col",
        justify,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
