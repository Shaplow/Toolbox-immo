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
 * Une seule courbe douce (pas un zigzag d'écolier).
 * Usage : <span>mot <HandDrawn.Underline className="block h-2 w-full text-brand-700" /></span>
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
 * Sparkle 4-pointes designer — twinkle organique inspiré des "marks"
 * éditoriaux (Notion, Apple Music). Remplace les anciens ✦ unicode et
 * les asterisks "étoile d'écolier".
 * Usage : préfixe d'eyebrow, signature, badge "nouveau".
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
      {/* Twinkle 4-branches : chaque "pointe" est une courbe Bezier qui
         ressort progressivement depuis le centre. Style designer mark. */}
      <path d="M10 1 C 10.4 6.5, 12.4 9.6, 19 10 C 12.4 10.4, 10.4 13.5, 10 19 C 9.6 13.5, 7.6 10.4, 1 10 C 7.6 9.6, 9.6 6.5, 10 1 Z" />
    </svg>
  );
}

/**
 * @deprecated Conservé pour rétrocompat — préférer `Sparkle`.
 * L'ancien asterisk "étoile" est ressenti trop scolaire.
 */
const Asterisk = Sparkle;

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
 * Cercle dessiné — entoure un élément pour le mettre en avant.
 * Forme elliptique organique avec ouverture (pas un cercle fermé
 * d'écolier qui souligne une faute). Pose en absolute autour du contenu.
 * Usage :
 *   <span className="relative">
 *     mot clé
 *     <HandDrawn.HighlightCircle className="absolute -inset-2 text-brand-700 -z-10" />
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
      {/* Ellipse organique avec micro-ouverture en haut-gauche : effet
         "tracé en un coup" plutôt que cercle parfait. */}
      <path
        d="M14 8 C 35 3, 70 4, 94 11 C 99 22, 88 33, 60 36 C 30 38, 8 32, 6 20 C 5 13, 9 9, 14 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Trait séparateur ondulé pleine largeur — pour séparer des sections
 * type éditorial (entre une citation et sa signature). Plus fin et plus
 * long que Underline.
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
  Sparkle,
  /** @deprecated alias vers Sparkle */
  Asterisk,
  Arrow,
  HighlightCircle,
  WavyRule,
  Bracket,
};
