/**
 * « Remplir la semaine » — la couche base de données de la répartition des
 * reels auto entre les comptes.
 *
 * Le calcul lui-même vit dans `lib/calendar/dispatch` (pur, testable sans
 * base). Ce module ne fait que trois choses : constituer le pool de recettes
 * proposables, reconstituer l'historique qui nourrit le tourniquet, et écrire.
 *
 * AUCUNE TABLE NOUVELLE. Tout l'historique se déduit des `PublicationSlot`
 * existants — la skill `asset-rotation` interdit de réintroduire un état de
 * curseur, et de toute façon un compteur serait une seconde vérité à tenir
 * synchronisée avec le calendrier que l'admin déplace à la main.
 */

import { prisma } from "@/lib/prisma";
import type { UserContext } from "@/lib/userContext";
import { ForbiddenError, ValidationError } from "@/lib/services/_runtime/errors";
import { createSlot } from "@/lib/services/slot/slotService";
import { parisDayKey, localInputToIso } from "@/lib/date/formatFr";
import { compareNatural } from "@/lib/utils/naturalSort";
import { patternLabel } from "@/lib/services/pattern/resolveEffective";
import {
  DISPATCH_WINDOW_DAYS,
  dayIndexFromKey,
  type DispatchCandidate,
  type RecipeHistory,
} from "@/lib/calendar/dispatch";

/** Au-delà, ce n'est plus un remplissage de semaine, c'est un script. */
export const WEEK_FILL_MAX_CELLS = 60;

/** Statuts qui ne comptent pas comme un usage : ils n'ont jamais touché l'audience. */
const NON_AUDIENCE_STATUSES = ["CANCELLED", "ARCHIVED"] as const;

export interface WeekFillAccount {
  id: string;
  name: string;
  handle: string;
}

export interface WeekFillContext {
  accounts: WeekFillAccount[];
  /** Recettes proposables, par compte. */
  candidatesByAccount: Record<string, DispatchCandidate[]>;
  /** Le pool complet dédupliqué, pour le sélecteur de l'écran. */
  pool: {
    patternTemplateId: string;
    label: string;
    /** `null` = recette pas encore rangée — l'écran en fait une entrée « Sans famille » de plein droit. */
    family: string | null;
    accountCount: number;
  }[];
  /**
   * Familles couvertes par les bindings ACTIFS de chaque compte (`null` inclus).
   *
   * Affiché sous chaque handle : un compte qui ne porte que du COMMERCE ne doit
   * pas disparaître silencieusement d'un remplissage TRANSACTION — le filtre
   * famille ne remplace pas une liaison mal placée, il la rend visible.
   */
  familiesByAccount: Record<string, (string | null)[]>;
  /**
   * Libellés portés par PLUSIEURS recettes du pool.
   *
   * Une version précédente les fusionnait silencieusement (par gabarit
   * partagé) : deux « RPI » ne sortaient jamais le même jour, mais huit RAUTO
   * du même gabarit s'enterraient mutuellement. On ne masque plus — on signale,
   * et l'admin fusionne ou archive.
   */
  duplicateLabels: string[];
  /** Où chaque recette est déjà posée, en index de jour. */
  existingUse: Record<string, RecipeHistory>;
  /** Jours déjà occupés : `accountId` → clés de jour. Ces cases ne sont jamais écrasées. */
  occupiedByAccount: Record<string, string[]>;
}

export interface BuildWeekFillContextInput {
  accountIds: string[];
  /** Bornes de la fenêtre d'historique (ISO). */
  windowFrom: Date;
  windowTo: Date;
  /** Restreint le pool. Vide/absent = toutes les recettes auto éligibles. */
  poolTemplateIds?: string[];
}

/**
 * Constitue le pool et l'historique.
 *
 * Volontairement PAS `listSlots` : elle charge renders, jobs et versions,
 * plafonne à 500, applique le scope rôle — et surtout `syncSlotsPipelineStatuses`
 * ÉCRIT EN BASE. Une lecture d'historique n'a pas à muter des statuts.
 *
 * La requête est filtrée par `accountId in (…)` + `scheduledAt between`, ce qui
 * utilise l'index `@@index([accountId, scheduledAt])`. Il n'y a PAS d'index sur
 * `patternBindingId` : filtrer par recette serait un scan.
 */
export async function buildWeekFillContext({
  accountIds,
  windowFrom,
  windowTo,
  poolTemplateIds,
}: BuildWeekFillContextInput): Promise<WeekFillContext> {
  if (accountIds.length === 0) {
    return {
      accounts: [],
      candidatesByAccount: {},
      pool: [],
      familiesByAccount: {},
      duplicateLabels: [],
      existingUse: {},
      occupiedByAccount: {},
    };
  }

  const [accounts, bindings, slots] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: { id: { in: accountIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, handle: true },
    }),
    prisma.patternBinding.findMany({
      where: {
        accountId: { in: accountIds },
        isActive: true,
        patternTemplate: {
          isArchived: false,
          // Les reels auto uniquement : un montage à rushs ne se « répartit »
          // pas, il suit un tournage.
          source: "auto_template",
          // Une recette qui exige une fiche n'est pas générable en lot — c'est
          // déjà la règle du moteur hebdo (skip `requires_entity`).
          requiresEntityTypeId: null,
          requiresProperty: false,
          ...(poolTemplateIds?.length ? { id: { in: poolTemplateIds } } : {}),
        },
      },
      select: {
        id: true,
        accountId: true,
        patternTemplateId: true,
        publishTime: true,
        customLabel: true,
        patternTemplate: { select: { label: true, family: true, createdAt: true } },
      },
      orderBy: { publishTime: "asc" },
    }),
    prisma.publicationSlot.findMany({
      where: {
        accountId: { in: accountIds },
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

  // ── Le pool, par compte ───────────────────────────────────────────────────
  const candidatesByAccount: Record<string, DispatchCandidate[]> = {};
  const poolByTemplate = new Map<
    string,
    { label: string; family: string | null; accountCount: number }
  >();
  const familiesByAccount: Record<string, (string | null)[]> = {};

  for (const b of bindings) {
    const label = patternLabel({
      customLabel: b.customLabel,
      patternTemplate: { label: b.patternTemplate.label },
    });
    (candidatesByAccount[b.accountId] ??= []).push({
      patternTemplateId: b.patternTemplateId,
      patternBindingId: b.id,
      publishTime: b.publishTime,
      label,
      templateCreatedAt: b.patternTemplate.createdAt.getTime(),
    });
    const family = b.patternTemplate.family ?? null;
    const families = (familiesByAccount[b.accountId] ??= []);
    if (!families.includes(family)) families.push(family);
    const entry = poolByTemplate.get(b.patternTemplateId);
    if (entry) entry.accountCount += 1;
    // Le libellé du pool est celui de la RECETTE, pas l'éventuel customLabel
    // d'un compte : deux comptes peuvent la renommer différemment.
    else
      poolByTemplate.set(b.patternTemplateId, {
        label: b.patternTemplate.label,
        family,
        accountCount: 1,
      });
  }

  // ── L'historique et l'occupation ──────────────────────────────────────────
  const existingUse: Record<string, RecipeHistory> = {};
  const occupiedByAccount: Record<string, string[]> = {};

  for (const slot of slots) {
    if (!slot.accountId || !slot.scheduledAt) continue;
    const dayKey = parisDayKey(slot.scheduledAt);
    (occupiedByAccount[slot.accountId] ??= []).push(dayKey);

    // L'identité de rotation, c'est LA RECETTE — le binding fait foi, le
    // template direct couvre les missions sans compte.
    //
    // Surtout PAS le gabarit builder : une version précédente regroupait les
    // recettes qui le partagent, et enterrait huit recettes dès que l'une
    // sortait (cf. le verrou dans les tests de ce service).
    const templateId = slot.patternBinding?.patternTemplateId ?? slot.patternTemplateId;
    if (!templateId) continue;

    const day = dayIndexFromKey(dayKey);
    const h = (existingUse[templateId] ??= { allDays: [], byAccount: {} });
    h.allDays.push(day);
    (h.byAccount[slot.accountId] ??= []).push(day);
  }

  const byLabel = new Map<string, number>();
  for (const v of poolByTemplate.values()) {
    byLabel.set(v.label, (byLabel.get(v.label) ?? 0) + 1);
  }

  // « Sans famille » en dernier : c'est un reste à ranger, pas une famille.
  for (const list of Object.values(familiesByAccount)) {
    list.sort((a, b) =>
      a === null ? 1 : b === null ? -1 : compareNatural(a, b),
    );
  }

  return {
    accounts,
    candidatesByAccount,
    familiesByAccount,
    duplicateLabels: [...byLabel.entries()]
      .filter(([, n]) => n > 1)
      .map(([label]) => label)
      .sort(compareNatural),
    pool: [...poolByTemplate.entries()]
      .map(([patternTemplateId, v]) => ({ patternTemplateId, ...v }))
      // Tri naturel : « RAUTO 2 » avant « RAUTO 10 ». Une liste de vingt
      // recettes numérotées est illisible autrement.
      .sort((a, b) => compareNatural(a.label, b.label)),
    existingUse,
    occupiedByAccount,
  };
}

export interface WeekFillCellInput {
  accountId: string;
  patternBindingId: string;
  /** Jour civil Paris, "YYYY-MM-DD". */
  dayKey: string;
  /** "HH:MM" — heure de publication retenue pour cette case. */
  time: string;
}

export interface WeekFillResult {
  ok: { slotId: string; accountId: string; dayKey: string; label: string }[];
  failed: { accountId: string; dayKey: string; label: string; error: string }[];
}

/**
 * Crée les publications d'un remplissage.
 *
 * Écriture par `createSlot` et rien d'autre : lui seul résout le binding, les
 * assignés par défaut, le statut initial et la légende pré-remplie.
 *
 * Résultats PARTIELS, convention du repo : une case refusée ne doit pas annuler
 * les autres.
 */
export async function applyWeekFill(
  cells: WeekFillCellInput[],
  ctx: UserContext,
): Promise<WeekFillResult> {
  if (!ctx.canAdminBypass) throw new ForbiddenError("Réservé aux administrateurs");
  if (cells.length === 0) return { ok: [], failed: [] };
  if (cells.length > WEEK_FILL_MAX_CELLS) {
    throw new ValidationError(
      `Trop de publications d'un coup (${cells.length}, maximum ${WEEK_FILL_MAX_CELLS}) — remplissez une semaine à la fois.`,
    );
  }

  const bindings = await prisma.patternBinding.findMany({
    where: { id: { in: cells.map((c) => c.patternBindingId) } },
    select: {
      id: true,
      accountId: true,
      customLabel: true,
      patternTemplate: { select: { label: true } },
    },
  });
  const bindingById = new Map(bindings.map((b) => [b.id, b]));

  /**
   * Occupation RE-VÉRIFIÉE ici, et au JOUR.
   *
   * Deux raisons, chacune suffisante : la clé d'idempotence du moteur hebdo
   * (`accountId, scheduledAt, patternBindingId`) ne protège pas contre « même
   * compte, même jour, autre recette, autre heure » ; et il peut s'écouler des
   * minutes entre l'aperçu et la confirmation — le temps qu'une publication
   * arrive par un autre chemin.
   */
  const dayKeys = [...new Set(cells.map((c) => c.dayKey))].sort();
  const occupied = new Set<string>();
  if (dayKeys.length > 0) {
    const from = new Date(`${dayKeys[0]}T00:00:00Z`);
    const to = new Date(`${dayKeys[dayKeys.length - 1]}T23:59:59Z`);
    // Marge d'un jour de chaque côté : la borne est en UTC, le jour est Paris.
    from.setUTCDate(from.getUTCDate() - 1);
    to.setUTCDate(to.getUTCDate() + 1);
    const existing = await prisma.publicationSlot.findMany({
      where: {
        accountId: { in: [...new Set(cells.map((c) => c.accountId))] },
        scheduledAt: { gte: from, lte: to },
        status: { notIn: [...NON_AUDIENCE_STATUSES] },
      },
      select: { accountId: true, scheduledAt: true },
    });
    for (const s of existing) {
      if (s.accountId && s.scheduledAt) occupied.add(`${s.accountId}|${parisDayKey(s.scheduledAt)}`);
    }
  }

  const result: WeekFillResult = { ok: [], failed: [] };
  /** Instants déjà posés dans CE lot — deux recettes peuvent partager une heure. */
  const takenInstants = new Set<string>();

  for (const cell of cells) {
    const binding = bindingById.get(cell.patternBindingId);
    const label = binding
      ? patternLabel({
          customLabel: binding.customLabel,
          patternTemplate: { label: binding.patternTemplate.label },
        })
      : "recette inconnue";
    const fail = (error: string) =>
      result.failed.push({ accountId: cell.accountId, dayKey: cell.dayKey, label, error });

    if (!binding) {
      fail("Recette introuvable — elle a peut-être été supprimée.");
      continue;
    }
    if (binding.accountId !== cell.accountId) {
      fail("Cette recette n'est pas activée sur ce compte.");
      continue;
    }
    if (occupied.has(`${cell.accountId}|${cell.dayKey}`)) {
      fail("Une publication existe déjà ce jour-là sur ce compte.");
      continue;
    }

    // L'instant, en heure de PARIS — comme la création à l'unité. Deux recettes
    // au même `publishTime` produiraient sinon deux slots à la milliseconde
    // près : on décale la seconde d'une minute plutôt que de les superposer.
    let iso = localInputToIso(`${cell.dayKey}T${cell.time}`);
    if (!iso) {
      fail(`Heure illisible (${cell.time}).`);
      continue;
    }
    let guard = 0;
    while (takenInstants.has(`${cell.accountId}|${iso}`) && guard < 60) {
      iso = new Date(new Date(iso).getTime() + 60_000).toISOString();
      guard += 1;
    }

    try {
      const slot = await createSlot(
        {
          accountId: cell.accountId,
          patternBindingId: cell.patternBindingId,
          scheduledAt: iso,
        },
        ctx,
      );
      takenInstants.add(`${cell.accountId}|${iso}`);
      // Un compte ne reçoit qu'UNE publication par jour dans un remplissage :
      // l'occupation vaut aussi pour les cases suivantes du même lot.
      occupied.add(`${cell.accountId}|${cell.dayKey}`);
      result.ok.push({ slotId: slot.id, accountId: cell.accountId, dayKey: cell.dayKey, label });
    } catch (err) {
      fail(err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  return result;
}

/** Fenêtre d'historique autour d'une semaine — bornes prêtes pour Prisma. */
export function dispatchWindow(weekStart: Date): { windowFrom: Date; windowTo: Date } {
  const windowFrom = new Date(weekStart);
  windowFrom.setUTCDate(windowFrom.getUTCDate() - DISPATCH_WINDOW_DAYS);
  const windowTo = new Date(weekStart);
  windowTo.setUTCDate(windowTo.getUTCDate() + DISPATCH_WINDOW_DAYS);
  return { windowFrom, windowTo };
}
