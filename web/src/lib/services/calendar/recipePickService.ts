/**
 * « Quelle recette pour ce compte, ce jour-là ? » — la résolution unitaire.
 *
 * LE BESOIN : créer une publication auto ne devrait pas demander de choisir
 * entre huit RAUTO interchangeables. L'admin choisit la FAMILLE, le tourniquet
 * choisit le membre — la même décision que « Remplir la semaine » prenait pour
 * une grille entière, ramenée à une case.
 *
 * Le calcul est celui de `lib/calendar/dispatch` (pur) : distance à
 * l'occurrence la plus proche PASSÉE OU FUTURE, et exclusion dure des recettes
 * déjà posées le même jour. Ce module constitue le pool, reconstitue
 * l'historique, et groupe le résultat par famille.
 *
 * AUCUNE TABLE NOUVELLE : l'historique se déduit des `PublicationSlot`
 * existants. La skill `asset-rotation` interdit de réintroduire un curseur, et
 * de toute façon un compteur serait une seconde vérité à tenir synchronisée
 * avec le calendrier que l'admin déplace à la main.
 *
 * DIVERGENCE ASSUMÉE avec le contrat de l'ancien `/api/calendar/week-fill`, qui
 * posait que « le GET ne renvoie que des données, jamais une proposition » : un
 * écran de grille pouvait recalculer lui-même à chaque case échangée, un bouton
 * unitaire n'a rien pour recalculer. On propose donc — mais on renvoie le
 * CLASSEMENT COMPLET et pas seulement le gagnant, pour que l'UI puisse offrir
 * « une autre » sans aller-retour.
 */

import { prisma } from "@/lib/prisma";
import { parisDayKey } from "@/lib/date/formatFr";
import { compareNatural } from "@/lib/utils/naturalSort";
import { patternLabel } from "@/lib/services/pattern/resolveEffective";
import {
  DISPATCH_WINDOW_DAYS,
  dayIndexFromKey,
  rankCandidatesForCell,
  type DispatchCandidate,
  type RecipeHistory,
} from "@/lib/calendar/dispatch";

/** Statuts qui ne comptent pas comme un usage : ils n'ont jamais touché l'audience. */
const NON_AUDIENCE_STATUSES = ["CANCELLED", "ARCHIVED"] as const;

/** Une recette proposable, avec sa fraîcheur. */
export interface RecipePickOption {
  patternBindingId: string;
  patternTemplateId: string;
  label: string;
  publishTime: string;
  /** Jours depuis l'occurrence la plus proche. `null` = jamais servie dans la fenêtre. */
  gapDays: number | null;
}

export interface RecipePickGroup {
  /** `null` = recettes pas encore rangées — un groupe de plein droit, affiché en dernier. */
  family: string | null;
  /**
   * TOUS les membres éligibles de la famille, y compris ceux écartés pour ce
   * jour — contrairement à `alternatives`, qui est le classement du jour.
   *
   * C'est ce qui permet à l'écran de savoir qu'une recette est déjà couverte
   * par une carte de famille et ne doit pas réapparaître à l'unité. S'appuyer
   * sur `alternatives` laisserait ressortir en double, chaque jour, la recette
   * qui vient justement de sortir.
   */
  memberBindingIds: string[];
  /**
   * Le choix du tourniquet. `null` quand toutes les recettes de la famille sont
   * déjà posées ce jour-là : la famille s'affiche alors désactivée plutôt que
   * de proposer un doublon.
   */
  picked: RecipePickOption | null;
  /** Classement complet, `picked` inclus en tête. */
  alternatives: RecipePickOption[];
}

export interface RecipePickResult {
  groups: RecipePickGroup[];
  /**
   * Ce compte a déjà une publication ce jour-là.
   *
   * AVERTISSEMENT, PAS REFUS — contrairement au remplissage de semaine, qui
   * refusait durement : un remplissage automatique ne doit pas empiler, mais un
   * admin qui crée une deuxième publication ce jour-là le fait exprès.
   */
  occupiedThisDay: boolean;
}

export interface BuildRecipePickInput {
  accountId: string;
  /** Jour civil Paris, "YYYY-MM-DD". */
  dayKey: string;
}

/** Fenêtre d'historique autour du jour visé — bornes prêtes pour Prisma. */
export function dispatchWindow(around: Date): { windowFrom: Date; windowTo: Date } {
  const windowFrom = new Date(around);
  windowFrom.setUTCDate(windowFrom.getUTCDate() - DISPATCH_WINDOW_DAYS);
  const windowTo = new Date(around);
  windowTo.setUTCDate(windowTo.getUTCDate() + DISPATCH_WINDOW_DAYS);
  return { windowFrom, windowTo };
}

export async function buildRecipePick({
  accountId,
  dayKey,
}: BuildRecipePickInput): Promise<RecipePickResult> {
  // Le jour visé au milieu de la journée : la fenêtre est symétrique, l'heure
  // n'entre pas dedans.
  const { windowFrom, windowTo } = dispatchWindow(new Date(`${dayKey}T12:00:00.000Z`));

  const [bindings, slots] = await Promise.all([
    prisma.patternBinding.findMany({
      where: {
        accountId,
        isActive: true,
        patternTemplate: {
          isArchived: false,
          // Les reels auto uniquement : un montage à rushs ne se « répartit »
          // pas, il suit un tournage.
          source: "auto_template",
          // Une recette qui exige une fiche ne se choisit pas au tourniquet —
          // c'est déjà la règle du moteur hebdo (skip `requires_entity`).
          requiresEntityTypeId: null,
          requiresProperty: false,
        },
      },
      select: {
        id: true,
        patternTemplateId: true,
        publishTime: true,
        customLabel: true,
        patternTemplate: { select: { label: true, family: true, createdAt: true } },
      },
      orderBy: { publishTime: "asc" },
    }),
    // TOUS LES COMPTES, volontairement.
    //
    // Le pool de recettes est celui du compte visé, mais l'historique ne peut
    // pas l'être : « pas 2× le même reel posté trop rapidement » vaut d'abord
    // ENTRE comptes, parce qu'ils partagent l'audience. Filtrer sur le compte
    // reviendrait à réintroduire le bug d'origine — la même recette lundi ici
    // et mardi à côté — tout en donnant l'impression que le tourniquet tourne.
    prisma.publicationSlot.findMany({
      where: {
        scheduledAt: { gte: windowFrom, lte: windowTo },
        status: { notIn: [...NON_AUDIENCE_STATUSES] },
      },
      select: {
        accountId: true,
        scheduledAt: true,
        patternTemplateId: true,
        patternBinding: { select: { patternTemplateId: true } },
      },
    }),
  ]);

  // ── Le pool du compte ─────────────────────────────────────────────────────
  const candidates: DispatchCandidate[] = [];
  const familyByTemplate = new Map<string, string | null>();
  for (const b of bindings) {
    candidates.push({
      patternTemplateId: b.patternTemplateId,
      patternBindingId: b.id,
      publishTime: b.publishTime,
      label: patternLabel({
        customLabel: b.customLabel,
        patternTemplate: { label: b.patternTemplate.label },
      }),
      templateCreatedAt: b.patternTemplate.createdAt.getTime(),
    });
    familyByTemplate.set(b.patternTemplateId, b.patternTemplate.family ?? null);
  }

  // ── L'historique et l'occupation ──────────────────────────────────────────
  const existingUse: Record<string, RecipeHistory> = {};
  const occupiedDays = new Set<string>();

  for (const slot of slots) {
    if (!slot.accountId || !slot.scheduledAt) continue;
    const slotDay = parisDayKey(slot.scheduledAt);
    if (slot.accountId === accountId) occupiedDays.add(slotDay);

    // L'identité de rotation, c'est LA RECETTE — le binding fait foi, le
    // template direct couvre les missions sans compte.
    //
    // Surtout PAS le gabarit builder : une version précédente regroupait les
    // recettes qui le partagent, et enterrait huit recettes dès que l'une
    // d'elles sortait.
    const templateId = slot.patternBinding?.patternTemplateId ?? slot.patternTemplateId;
    if (!templateId) continue;

    const day = dayIndexFromKey(slotDay);
    const h = (existingUse[templateId] ??= { allDays: [], byAccount: {} });
    h.allDays.push(day);
    (h.byAccount[slot.accountId] ??= []).push(day);
  }

  // ── Le groupement par famille ─────────────────────────────────────────────
  const byFamily = new Map<string, { family: string | null; pool: DispatchCandidate[] }>();
  for (const candidate of candidates) {
    const family = familyByTemplate.get(candidate.patternTemplateId) ?? null;
    // Clé distincte de la valeur : `null` et la chaîne "null" doivent rester
    // deux groupes différents si jamais quelqu'un nomme une famille « null ».
    const key = family === null ? "\u0000none" : family;
    const entry = byFamily.get(key);
    if (entry) entry.pool.push(candidate);
    else byFamily.set(key, { family, pool: [candidate] });
  }

  const groups: RecipePickGroup[] = [...byFamily.values()].map(({ family, pool }) => {
    const ranked = rankCandidatesForCell({ accountId, dayKey, rank: 0 }, pool, existingUse);
    const options: RecipePickOption[] = ranked.map((option) => ({
      patternBindingId: option.candidate.patternBindingId,
      patternTemplateId: option.candidate.patternTemplateId,
      label: option.candidate.label,
      publishTime: option.candidate.publishTime,
      gapDays: option.rawGap,
    }));
    return {
      family,
      memberBindingIds: pool.map((c) => c.patternBindingId),
      picked: options[0] ?? null,
      alternatives: options,
    };
  });

  // « Sans famille » en dernier : c'est un reste à ranger, pas une famille.
  groups.sort((a, b) =>
    a.family === null ? 1 : b.family === null ? -1 : compareNatural(a.family, b.family),
  );

  return { groups, occupiedThisDay: occupiedDays.has(dayKey) };
}
