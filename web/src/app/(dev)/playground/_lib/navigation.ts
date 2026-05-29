/**
 * Source de vérité unique de la nav playground.
 * - Les `items` peuvent être un lien externe (autre page) ou une ancre (#id) de la page courante.
 * - Le scrollspy utilise les ids des items pour déterminer la section active.
 *
 * État Phase 2 Liquid Glass : foundations + atoms en vitrine pour validation.
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
  {
    label: "Foundations",
    basePath: "/playground/foundations",
    items: [
      { label: "Palette Coastal", href: "/playground/foundations#palette" },
      { label: "Surfaces glass", href: "/playground/foundations#surfaces" },
      { label: "Backdrop blur", href: "/playground/foundations#blur" },
      { label: "Shadows verrerie", href: "/playground/foundations#shadows" },
      { label: "Scrims", href: "/playground/foundations#scrims" },
      { label: "Gradients washes", href: "/playground/foundations#gradients" },
    ],
  },
  {
    label: "Atoms · Actions",
    basePath: "/playground/atoms",
    items: [
      { label: "Button", href: "/playground/atoms#button" },
      { label: "ButtonIcon", href: "/playground/atoms#button-icon" },
      { label: "DropdownMenu", href: "/playground/atoms#dropdown-menu" },
    ],
  },
  {
    label: "Atoms · Forms",
    basePath: "/playground/atoms",
    items: [
      { label: "Input", href: "/playground/atoms#input" },
      { label: "Textarea", href: "/playground/atoms#textarea" },
      { label: "Select", href: "/playground/atoms#select" },
      { label: "Switch", href: "/playground/atoms#switch" },
      { label: "Slider", href: "/playground/atoms#slider" },
    ],
  },
  {
    label: "Atoms · Feedback",
    basePath: "/playground/atoms",
    items: [
      { label: "Toast", href: "/playground/atoms#toast" },
      { label: "EmptyState", href: "/playground/atoms#empty-state" },
      { label: "Skeleton", href: "/playground/atoms#skeleton" },
      { label: "Tooltip", href: "/playground/atoms#tooltip" },
    ],
  },
  {
    label: "Atoms · Overlays",
    basePath: "/playground/atoms",
    items: [
      { label: "ConfirmDialog", href: "/playground/atoms#confirm-dialog" },
      { label: "MediaDropzone", href: "/playground/atoms#dropzone" },
    ],
  },
  {
    label: "Atoms · Data",
    basePath: "/playground/atoms",
    items: [
      { label: "Badge", href: "/playground/atoms#badge" },
      { label: "Card", href: "/playground/atoms#card" },
      { label: "Tabs", href: "/playground/atoms#tabs" },
      { label: "Kbd", href: "/playground/atoms#kbd" },
      { label: "CollapsibleSection", href: "/playground/atoms#collapsible" },
    ],
  },
  {
    label: "Phase 3 · Overlays",
    basePath: "/playground/atoms-new",
    items: [
      { label: "Modal", href: "/playground/atoms-new#modal" },
      { label: "Drawer", href: "/playground/atoms-new#drawer" },
      { label: "Sheet", href: "/playground/atoms-new#sheet" },
    ],
  },
];

/** Tous les ids ancrables d'une page donnée. */
export function anchorIdsForPath(pathname: string): string[] {
  return NAV.filter((section) => section.basePath === pathname)
    .flatMap((section) => section.items.map((item) => item.href))
    .filter((href) => href.includes("#"))
    .map((href) => href.split("#")[1]);
}
