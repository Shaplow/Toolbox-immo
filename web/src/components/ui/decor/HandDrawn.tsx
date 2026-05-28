/**
 * Décors SVG hand-drawn — signature visuelle style Excalidraw.
 *
 * Doctrine d'usage :
 * - Réservés aux accents personnalité (eyebrow, badge "Astuce", highlight
 *   marketing). JAMAIS dans l'UI fonctionnelle (panneaux, fiches,
 *   formulaires).
 * - Toujours en `currentColor` — héritent de la couleur texte du parent.
 * - Pas de bibliothèque externe (Rough.js) : SVG path statiques bien
 *   foutus, légers, accessibles via `<HandDrawn.X />`.
 */

import type { SVGProps } from "react";

interface DecorProps extends SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * Trait souligné ondulé — pour mettre en avant un mot dans un titre.
 * Usage : <span>mot <HandDrawn.Underline className="block h-2 w-full text-brand-600" /></span>
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
        d="M2 5 Q 10 1, 20 4 T 40 4 T 60 4 T 80 4 T 98 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Asterisk dessiné — remplace le ✦ unicode pour un côté plus signature.
 * Usage : préfixe d'eyebrow marketing ou bullet de listes signature.
 */
function Asterisk({ className, ...rest }: DecorProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <path
        d="M10 2 Q 10.5 10, 10.2 18 M 3.5 5.5 Q 10 10, 16.5 14.5 M 16.5 5.5 Q 10 10, 3.5 14.5 M 2 10 Q 10 9.5, 18 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Flèche dessinée — pour les liens narratifs ou les pointeurs de schéma.
 * Usage : <span>Voir l'exemple <HandDrawn.Arrow className="inline h-3 w-8 text-brand-600" /></span>
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

/**
 * Cercle dessiné — entoure un élément pour le mettre en avant (genre
 * cercle au crayon sur un mot clé). Pose en absolute autour du contenu.
 * Usage :
 *   <span className="relative">
 *     mot clé
 *     <HandDrawn.HighlightCircle className="absolute -inset-2 text-brand-600 -z-10" />
 *   </span>
 */
function HighlightCircle({ className, ...rest }: DecorProps) {
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <path
        d="M8 6 Q 30 2, 60 4 Q 92 6, 95 12 Q 97 28, 80 34 Q 50 38, 20 36 Q 5 33, 7 18 Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Bracket carré dessiné — pour cadrer un élément texte signature
 * (genre [astuce] ou [nouveau]). Pose en flanc gauche/droit.
 */
function Bracket({
  side = "left",
  className,
  ...rest
}: DecorProps & { side?: "left" | "right" }) {
  const path =
    side === "left"
      ? "M14 2 Q 4 4, 4 10 T 4 20 T 4 30 Q 4 36, 14 38"
      : "M4 2 Q 14 4, 14 10 T 14 20 T 14 30 Q 14 36, 4 38";
  return (
    <svg
      viewBox="0 0 18 40"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const HandDrawn = {
  Underline,
  Asterisk,
  Arrow,
  HighlightCircle,
  Bracket,
};
