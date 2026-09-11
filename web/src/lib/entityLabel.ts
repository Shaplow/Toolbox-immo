/**
 * Libellé automatique d'une fiche (Entity), dérivé de ses champs custom.
 *
 * Un type de fiche peut porter un `labelTemplate` en syntaxe `{{clé}}` (ex.
 * `{{adresse}}, {{ville}}`) : les fiches de ce type n'ont alors plus de libellé
 * à saisir, il est calculé. Sans modèle, tout se comporte comme avant — le
 * libellé reste tapé à la main.
 *
 * Le moteur est celui des légendes (`lib/textTemplate` + `lib/systemTokens`),
 * dans le même ordre que partout ailleurs : `resolveSystemTokens ∘
 * resolveTextTemplate`. Précédent direct : `publications/preFilledDescription`.
 *
 * Module PUR (aucun import Prisma) : c'est ce qui permet aux formulaires
 * client d'afficher l'aperçu en important CE helper plutôt qu'en réimplémentant
 * le calcul — un miroir écrit à la main finit toujours par diverger du serveur.
 */

import type { CustomField } from "@/lib/customFields";
import { numericDateFr } from "@/lib/date/formatFr";
import { resolveSystemTokens } from "@/lib/systemTokens";
import { extractTemplateVars, resolveTextTemplate } from "@/lib/textTemplate";
import type { ListingData } from "@/types/listing";

/** Longueur max d'un libellé de fiche, saisi comme dérivé. */
export const MAX_ENTITY_LABEL = 200;

/** Au-delà, on coupe au dernier espace plutôt qu'en plein mot. */
const WORD_BOUNDARY_FLOOR = 180;

/** Le strict nécessaire d'un EntityType pour calculer un libellé. */
export interface EntityLabelType {
  name: string;
  labelTemplate?: string | null;
}

export type EntityFieldsInput = string | Record<string, unknown> | null | undefined;

/** Le type dérive-t-il ses libellés ? */
export function hasLabelTemplate(type: EntityLabelType): boolean {
  return (type.labelTemplate ?? "").trim().length > 0;
}

/**
 * Parse tolérant de la colonne `fields` (JSON `Record<string,string>`).
 * Repris de `preFilledDescription.ts` — même contrat, même tolérance.
 */
function parseFields(input: EntityFieldsInput): Record<string, unknown> {
  if (input == null) return {};
  if (typeof input === "object") return Array.isArray(input) ? {} : input;
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Nettoie le rendu brut d'un modèle.
 *
 * Sans ça, le repli ne se déclencherait jamais : `{{adresse}}, {{ville}}` avec
 * les deux champs vides rend `", "`, dont le trim donne `","` — non vide. Un
 * champ vide au milieu laisse de même des séparateurs en double.
 */
function tidy(raw: string): string {
  return raw
    // Un champ `textarea` sur plusieurs lignes casserait le <h1> et les cellules.
    .replace(/\s+/g, " ")
    // « A, , C » (trou au milieu) → « A, C ».
    .replace(/(\s*[,;·|/]\s*){2,}/g, ", ")
    // Séparateurs orphelins laissés par un trou en tête ou en fin.
    .replace(/^[\s,;·—–\-|/]+|[\s,;·—–\-|/]+$/g, "")
    .trim();
}

/** Coupe à MAX_ENTITY_LABEL, au mot près quand c'est raisonnable. */
function truncate(label: string): string {
  if (label.length <= MAX_ENTITY_LABEL) return label;
  const cut = label.slice(0, MAX_ENTITY_LABEL - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > WORD_BOUNDARY_FLOOR ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * Rend le modèle du type contre les champs d'une fiche, SANS repli.
 *
 * Retourne `""` si le type n'a pas de modèle ou si le rendu ne produit rien
 * d'exploitable — c'est ce que les formulaires affichent tant que l'utilisateur
 * n'a rien saisi (montrer le repli daté d'emblée ressemblerait à un bug).
 */
export function renderLabelTemplate(
  type: EntityLabelType,
  fields: EntityFieldsInput,
  opts: { now?: Date } = {},
): string {
  const template = (type.labelTemplate ?? "").trim();
  if (!template) return "";

  // Pas de `schema` passé au moteur : `resolveVariableValue` retombe alors sur
  // la valeur stockée telle quelle. Parité avec preFilledDescription, et un
  // CustomField ne porte de toute façon aucune option de formatage numérique.
  const listing = parseFields(fields) as unknown as ListingData;
  const resolved = resolveSystemTokens(resolveTextTemplate(template, listing), opts.now);
  return truncate(tidy(resolved));
}

/**
 * Libellé effectif d'une fiche : le modèle rendu, sinon « <Type> du <date> ».
 *
 * Ne retourne JAMAIS une chaîne vide et ne dépasse jamais `MAX_ENTITY_LABEL` —
 * une fiche sans libellé serait introuvable dans les listes, et lever une
 * erreur ici bloquerait une commande client sur un champ non rempli.
 *
 * Le repli passe par `numericDateFr`, qui fige `Europe/Paris` : l'aperçu du
 * formulaire et la valeur écrite par le serveur ne peuvent pas diverger de
 * part et d'autre de minuit.
 */
export function resolveEntityLabel(
  type: EntityLabelType,
  fields: EntityFieldsInput,
  opts: { now?: Date } = {},
): string {
  const rendered = renderLabelTemplate(type, fields, opts);
  if (rendered) return rendered;
  return truncate(`${type.name} du ${numericDateFr(opts.now ?? new Date())}`);
}

/**
 * Clés `{{…}}` du modèle absentes du schéma du type.
 *
 * Une clé inconnue rend silencieusement du vide : le libellé s'ampute, au pire
 * jusqu'au repli. D'où le refus côté API et l'avertissement dans le drawer,
 * plutôt qu'une découverte a posteriori sur une fiche mal nommée.
 */
export function findUnknownTemplateKeys(
  template: string | null | undefined,
  schema: CustomField[],
): string[] {
  const tpl = (template ?? "").trim();
  if (!tpl) return [];
  const known = new Set(schema.map((f) => f.key));
  // `{{maintenant:preset}}` n'apparaît pas ici : le `:` l'empêche d'être une
  // variable, il traverse resolveTextTemplate en texte et n'est résolu qu'après
  // par resolveSystemTokens. `{{maintenant}}` NU, lui, est bien une variable —
  // donc consommé (et vidé) par resolveTextTemplate avant que le résolveur de
  // tokens le voie. Le signaler comme clé inconnue est exact : il rend vide.
  return [...new Set(extractTemplateVars(tpl))].filter((key) => !known.has(key));
}
