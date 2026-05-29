/**
 * Source de vérité unique de la nav playground.
 * - Les `items` peuvent être un lien externe (autre page) ou une ancre (#id) de la page courante.
 * - Le scrollspy utilise les ids des items pour déterminer la section active.
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
    basePath: "/playground/tokens",
    items: [
      { label: "Doctrine", href: "/playground/tokens#doctrine" },
      { label: "Colors", href: "/playground/tokens#colors" },
      { label: "Brand", href: "/playground/tokens#brand" },
      { label: "Accents", href: "/playground/tokens#accents" },
      { label: "Typography", href: "/playground/tokens#typography" },
      { label: "Spacing", href: "/playground/tokens#spacing" },
      { label: "Radius", href: "/playground/tokens#radius" },
      { label: "Elevation", href: "/playground/tokens#elevation" },
      { label: "Motion", href: "/playground/tokens#motion" },
      { label: "States", href: "/playground/tokens#states" },
    ],
  },
  {
    label: "Components / Actions",
    basePath: "/playground/primitives",
    items: [
      { label: "Button", href: "/playground/primitives#button" },
      { label: "ButtonIcon", href: "/playground/primitives#button-icon" },
      { label: "DropdownMenu", href: "/playground/primitives#dropdown-menu" },
    ],
  },
  {
    label: "Components / Forms",
    basePath: "/playground/primitives",
    items: [
      { label: "Input", href: "/playground/primitives#input" },
      { label: "Textarea", href: "/playground/primitives#textarea" },
      { label: "Select", href: "/playground/primitives#select" },
      { label: "FormField", href: "/playground/primitives#form-field" },
      { label: "Switch", href: "/playground/primitives#switch" },
      { label: "Slider", href: "/playground/primitives#slider" },
    ],
  },
  {
    label: "Components / Feedback",
    basePath: "/playground/primitives",
    items: [
      { label: "Toast", href: "/playground/primitives#toast" },
      { label: "EmptyState", href: "/playground/primitives#empty-state" },
      { label: "Skeleton", href: "/playground/primitives#skeleton" },
      { label: "Tooltip", href: "/playground/primitives#tooltip" },
    ],
  },
  {
    label: "Components / Overlays",
    basePath: "/playground/primitives",
    items: [
      { label: "ConfirmDialog", href: "/playground/primitives#confirm-dialog" },
      { label: "DeleteButton", href: "/playground/primitives#delete-button" },
    ],
  },
  {
    label: "Components / Data",
    basePath: "/playground/primitives",
    items: [
      { label: "Badge", href: "/playground/primitives#badge" },
      { label: "Card", href: "/playground/primitives#card" },
      { label: "Tabs", href: "/playground/primitives#tabs" },
      { label: "Kbd", href: "/playground/primitives#kbd" },
    ],
  },
  {
    label: "Components / Signature",
    basePath: "/playground/primitives",
    items: [{ label: "Signature discrète", href: "/playground/primitives#signature" }],
  },
  {
    label: "Marketing",
    basePath: "/playground/marketing",
    items: [
      { label: "Typography", href: "/playground/marketing#typography" },
      { label: "Hero pattern", href: "/playground/marketing#hero" },
      { label: "Pull quote", href: "/playground/marketing#pull-quote" },
      { label: "Décors", href: "/playground/marketing#decorations" },
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
