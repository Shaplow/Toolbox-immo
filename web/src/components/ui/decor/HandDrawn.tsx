/**
 * Décors SVG signature — minimaux et chirurgicaux.
 *
 * Doctrine d'usage :
 * - Réservés aux accents personnalité (eyebrow, badge "Astuce", lien
 *   narratif). JAMAIS dans l'UI fonctionnelle (panneaux, fiches,
 *   formulaires).
 * - Toujours en `currentColor` — héritent de la couleur texte du parent.
 * - Limités à 2 décors : Sparkle (marque éditoriale) + Arrow (signature
 *   de lien). Les typos (Serif italic, Caveat hand) font le reste — on
 *   évite la surcharge graphique scolaire.
 */

import type { SVGProps } from "react";

interface DecorProps extends SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * Sparkle 4-pointes designer — twinkle organique inspiré des "marks"
 * éditoriaux (Notion, Apple Music). Pour les eyebrows, badges "nouveau",
 * accents dans les avatars.
 */
function Sparkle({ className, ...rest }: DecorProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden
      {...rest}
    >
      <path d="M10 1 C 10.4 6.5, 12.4 9.6, 19 10 C 12.4 10.4, 10.4 13.5, 10 19 C 9.6 13.5, 7.6 10.4, 1 10 C 7.6 9.6, 9.6 6.5, 10 1 Z" />
    </svg>
  );
}

/**
 * Flèche dessinée — pour les liens narratifs ("Voir l'exemple →").
 * Style signature pen, pas géométrique parfait. Animation conseillée :
 * `transition-transform group-hover:translate-x-0.5`.
 */
function Arrow({ className, ...rest }: DecorProps) {
  return (
    <svg
      viewBox="0 0 50 20"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <path
        d="M2 11 Q 14 8, 30 11 T 46 10 M 38 4 L 46 10 L 38 16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const HandDrawn = {
  Sparkle,
  Arrow,
};
