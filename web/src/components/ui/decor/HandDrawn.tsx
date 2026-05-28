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
 * Trait souligné subtil — une seule courbe Bezier douce.
 * Usage ponctuel sous un mot clé d'une citation ou d'un hero serif.
 * Strictement réservé aux contextes éditoriaux (testimonial, hero).
 * Pas dans les titres d'UI fonctionnelle.
 */
function Underline({ className, ...rest }: DecorProps) {
  return (
    <svg
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <path
        d="M3 5 C 25 1, 60 6, 97 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Trait séparateur ondulé fin — entre une citation et sa signature, ou
 * comme divider éditorial discret. Pas dans l'UI fonctionnelle.
 */
function WavyRule({ className, ...rest }: DecorProps) {
  return (
    <svg
      viewBox="0 0 200 6"
      preserveAspectRatio="none"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <path
        d="M2 3 C 30 1, 50 5, 80 3 C 110 1, 130 5, 160 3 C 180 2, 190 4, 198 3"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
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
  Underline,
  WavyRule,
};
