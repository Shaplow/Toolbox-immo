/**
 * Source de vérité unique de la nav playground.
 * - Les `items` peuvent être un lien externe (autre page) ou une ancre (#id) de la page courante.
 * - Le scrollspy utilise les ids des items pour déterminer la section active.
 *
 * Phase 0 (cleanup) : NAV vidé pendant la refonte Liquid Glass.
 * Sera reconstruite en Phase 5 avec les sections foundations / atoms /
 * molecules / patterns / vibes.
 */

export type NavItem = {
  /** Label affiché. */
  label: string;
  /** Soit "#anchor" (lien intra-page), soit "/playground/..." (lien externe). */
  href: string;
};

export type NavSection = {
  /** Label de la famille (uppercase petit en sidebar). */
  label: string;
  /** Route racine de la famille — sert à détecter "section active". */
  basePath: string;
  /** Items intra-page de cette famille. */
  items: NavItem[];
};

export const NAV: NavSection[] = [
  {
    label: "Playground",
    basePath: "/playground",
    items: [{ label: "Overview", href: "/playground" }],
  },
];

/** Tous les ids ancrables d'une page donnée. */
export function anchorIdsForPath(pathname: string): string[] {
  return NAV.filter((section) => section.basePath === pathname)
    .flatMap((section) => section.items.map((item) => item.href))
    .filter((href) => href.includes("#"))
    .map((href) => href.split("#")[1]);
}
