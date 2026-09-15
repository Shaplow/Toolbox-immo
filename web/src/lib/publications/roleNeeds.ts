/**
 * Les rôles dont une recette a RÉELLEMENT besoin — dérivés, jamais saisis.
 *
 * Le problème, dans les mots de l'admin : « sur certaines recettes, y'a pas
 * besoin de vidéaste ou monteur, et c'est chiant parce que sur le dashboard
 * admin j'ai des vidéos marquées "sans vidéaste", mais y'en a juste pas besoin
 * en fait ».
 *
 * L'alerte était structurellement fausse : une recette `auto_template` naît au
 * statut `PLANNED` (`calendarEngine.mapSourceToInitialStatus`), et c'est
 * précisément l'un des deux statuts que l'inbox scanne pour crier « sans
 * vidéaste ». Toute publication auto alimentait donc une alerte qui n'avait
 * aucun sens : il n'y a rien à filmer.
 *
 * DÉRIVÉ et non stocké, comme `needsRushes` l'est déjà de `source`
 * (`services/slot/effectivePattern.ts`, `services/pattern/resolveEffective.ts`) :
 * un drapeau de plus se désynchroniserait de la source à la première recette
 * qu'on bascule d'un mode à l'autre.
 */

/** Ce qu'il faut savoir d'une recette pour en déduire les rôles. */
export interface RoleNeedsPattern {
  source?: string | null;
  needsBrief?: boolean | null;
  coverMode?: string | null;
}

/**
 * Un vidéaste ne sert qu'à filmer.
 *
 * `auto_template` génère sans tournage, `external_upload` reçoit une vidéo déjà
 * faite : ni l'un ni l'autre n'a quelqu'un à envoyer sur place.
 */
export function needsVideaste(pattern: RoleNeedsPattern | null | undefined): boolean {
  return pattern?.source === "manual_rushes";
}

/**
 * Un monteur, c'est plus large que « il y a des rushs ».
 *
 * Deux échappatoires, et elles ne sont pas théoriques — les ignorer masquerait
 * un champ dont l'étape, elle, resterait affichée à l'écran :
 *  - `coverMode === "monteurUpload"` : l'étape « Cover (monteur) » est à lui
 *    (`publications/steps.ts`), même sur une recette auto ;
 *  - `needsBrief` : un brief rend l'étape Montage visible (idem), donc quelqu'un
 *    monte.
 */
export function needsMonteur(pattern: RoleNeedsPattern | null | undefined): boolean {
  if (!pattern) return false;
  return (
    pattern.source === "manual_rushes" ||
    pattern.needsBrief === true ||
    pattern.coverMode === "monteurUpload"
  );
}

/**
 * Le CM n'est jamais optionnel : l'étape `publish` est visible sur toutes les
 * recettes, sans condition. Fonction quand même exportée pour que les
 * appelants traitent les trois rôles de la même façon, sans cas particulier
 * écrit à la main chez eux.
 */
export function needsCm(): boolean {
  return true;
}

/**
 * Filtre Prisma : les slots dont la recette EFFECTIVE a besoin de ce rôle.
 *
 * Un slot tient sa recette de `patternBinding.patternTemplate` (le cas normal)
 * ou de `patternTemplate` en direct (missions sans compte). Un slot qui n'a NI
 * l'un NI l'autre n'a pas de recette du tout : il n'entre dans aucune des deux
 * branches, et c'est voulu — il est déjà remonté par la typologie `no_pattern`,
 * qui est sa vraie cause. Deux alertes pour un même problème valent moins qu'une.
 */
function slotWhereForTemplate(templateWhere: object) {
  return {
    OR: [
      { patternBinding: { patternTemplate: templateWhere } },
      { patternBindingId: null, patternTemplate: templateWhere },
    ],
  };
}

/** Miroir Prisma de `needsVideaste`. */
export const SLOT_NEEDS_VIDEASTE_WHERE = slotWhereForTemplate({ source: "manual_rushes" });

/** Miroir Prisma de `needsMonteur` — mêmes trois conditions, en OR. */
export const SLOT_NEEDS_MONTEUR_WHERE = slotWhereForTemplate({
  OR: [{ source: "manual_rushes" }, { needsBrief: true }, { coverMode: "monteurUpload" }],
});
