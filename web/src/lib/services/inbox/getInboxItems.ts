/**
 * getInboxItems — agrège en UNE liste tous les items qui attendent une
 * action de l'ADMIN. Remplace les 6 KPI éparpillés de HomeAdmin V1.
 *
 * Chaque item porte :
 *  - une `typology` qui détermine le badge + l'action inline
 *  - un `score` de priorité (plus haut = plus urgent)
 *  - le slot associé (sérialisé minimum)
 *
 * Tri final : score DESC, puis updatedAt DESC pour tie-break.
 *
 * Bench cible : < 200ms pour ~30 comptes, ~200 slots actifs. Les queries
 * sont parallélisées via Promise.all, chacune avec `take: ITEM_LIMIT_PER_TYPE`
 * pour éviter d'exploser la mémoire si un type a 500 items.
 */

import { patternLabel } from "@/lib/services/pattern/resolveEffective";
import { prisma } from "@/lib/prisma";
import { validatedForTeamFilter } from "@/lib/permissions/entityScope";
import type { SlotStatus } from "@/types/roles";

export type InboxTypology =
  | "version_review" // EDIT_REVIEW avec version pending
  | "overdue" // scheduledAt < now & non-terminal
  | "no_monteur" // sans monteur assigné
  | "no_videaste" // sans vidéaste assigné
  | "no_pattern" // sans recette
  | "rushes_overdue" // RUSHES_EXPECTED & scheduledAt < now
  | "bank_ready" // banque prête à programmer
  | "shoot_declined" // tournage : le vidéaste s'est déclaré indisponible
  | "shoot_unconfirmed"; // tournage : le vidéaste n'a pas encore répondu

export interface InboxItem {
  id: string;
  typology: InboxTypology;
  score: number;
  /**
   * Fiche concernée — présent pour les typologies `shoot_*`, qui portent sur un
   * tournage (Entity) et non sur une publication. Exclusif avec `slot`.
   */
  entity?: {
    id: string;
    label: string;
    scheduledAt: string | null;
    updatedAt: string;
    accountHandle: string | null;
    accountName: string | null;
    videasteName: string | null;
    declineReason: string | null;
  };
  slot?: {
    id: string;
    title: string | null;
    status: string;
    scheduledAt: string | null;
    updatedAt: string;
    patternLabel: string | null;
    accountHandle: string | null;
    accountName: string | null;
    accountId: string | null;
    assigneeMonteurId: string | null;
    assigneeVideasteId: string | null;
    assigneeCmId: string | null;
    currentVersionId: string | null;
  };
  /**
   * Latest version pending (pour version_review). Présent seulement si
   * typology = "version_review".
   */
  latestVersion?: {
    id: string;
    versionNumber: number;
    createdAt: string;
  };
}

const ITEM_LIMIT_PER_TYPE = 20;

/** Fenêtre de rattrapage des tournages passés jamais confirmés (jours). */
const SHOOT_UNCONFIRMED_GRACE_DAYS = 30;

function inboxShootFloor(now: Date): Date {
  return new Date(now.getTime() - SHOOT_UNCONFIRMED_GRACE_DAYS * 24 * 60 * 60 * 1000);
}
const MAX_TOTAL_ITEMS = 60;

// Statuts considérés "actifs" (en cours, non terminés).
const ACTIVE_STATUSES_FOR_OVERDUE: SlotStatus[] = [
  "PLANNED",
  "RUSHES_EXPECTED",
  "RUSHES_RECEIVED",
  "IN_EDIT",
  "EDIT_REVIEW",
  "EDIT_APPROVED",
  "READY_FOR_CM",
  "SCHEDULED",
];

const SLOT_SELECT = {
  id: true,
  title: true,
  status: true,
  scheduledAt: true,
  updatedAt: true,
  assigneeMonteurId: true,
  assigneeVideasteId: true,
  assigneeCmId: true,
  currentVersionId: true,
  patternBinding: {
    select: { customLabel: true, patternTemplate: { select: { label: true } } },
  },
  patternTemplate: { select: { label: true } },
  account: { select: { id: true, handle: true, name: true } },
} as const;

const ENTITY_SELECT = {
  id: true,
  label: true,
  scheduledAt: true,
  updatedAt: true,
  videasteConfirmation: true,
  videasteDeclineReason: true,
  assigneeVideaste: { select: { name: true } },
  account: { select: { handle: true, name: true } },
} as const;

type EntityRaw = Awaited<
  ReturnType<typeof prisma.entity.findMany<{ select: typeof ENTITY_SELECT }>>
>[number];

function serializeEntity(e: EntityRaw): InboxItem["entity"] {
  return {
    id: e.id,
    label: e.label,
    scheduledAt: e.scheduledAt ? e.scheduledAt.toISOString() : null,
    updatedAt: e.updatedAt.toISOString(),
    accountHandle: e.account?.handle ?? null,
    accountName: e.account?.name ?? null,
    videasteName: e.assigneeVideaste?.name ?? null,
    declineReason: e.videasteDeclineReason,
  };
}

type SlotRaw = Awaited<
  ReturnType<typeof prisma.publicationSlot.findMany<{ select: typeof SLOT_SELECT }>>
>[number];

function serializeSlot(s: SlotRaw): InboxItem["slot"] {
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    scheduledAt: s.scheduledAt ? s.scheduledAt.toISOString() : null,
    updatedAt: s.updatedAt.toISOString(),
    patternLabel: patternLabel(s.patternBinding) ?? s.patternTemplate?.label ?? null,
    accountHandle: s.account?.handle ?? null,
    accountName: s.account?.name ?? null,
    accountId: s.account?.id ?? null,
    assigneeMonteurId: s.assigneeMonteurId,
    assigneeVideasteId: s.assigneeVideasteId,
    assigneeCmId: s.assigneeCmId,
    currentVersionId: s.currentVersionId,
  };
}

/**
 * Récupère et trie l'inbox de l'admin.
 *
 * Pattern : on lance 6-7 queries en parallèle, on déduplique sur slot.id
 * (un slot peut matcher plusieurs typologies — ex. sans monteur + en retard),
 * on garde la typologie au score le plus haut.
 *
 * Pagination : retour limité à MAX_TOTAL_ITEMS, l'admin filtre via tabs UI.
 */
export async function getInboxItems(): Promise<InboxItem[]> {
  const now = new Date();

  const [
    versionReviewSlots,
    overdueSlots,
    noMonteurSlots,
    noVideasteSlots,
    noPatternSlots,
    rushesOverdueSlots,
    bankReadySlots,
    shootDeclinedEntities,
    shootUnconfirmedEntities,
  ] = await Promise.all([
    // Versions à valider (EDIT_REVIEW + version pending).
    prisma.publicationSlot.findMany({
      where: { status: "EDIT_REVIEW", currentVersionId: { not: null } },
      select: {
        ...SLOT_SELECT,
        versions: {
          where: { deletedAt: null },
          select: { id: true, versionNumber: true, createdAt: true },
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: ITEM_LIMIT_PER_TYPE,
    }),
    // Slots en retard (scheduledAt passé, statut actif non terminal).
    prisma.publicationSlot.findMany({
      where: {
        scheduledAt: { lt: now, not: null },
        status: { in: ACTIVE_STATUSES_FOR_OVERDUE },
      },
      select: SLOT_SELECT,
      orderBy: { scheduledAt: "asc" },
      take: ITEM_LIMIT_PER_TYPE,
    }),
    // Slots sans monteur (statuts qui requièrent un monteur).
    prisma.publicationSlot.findMany({
      where: {
        assigneeMonteurId: null,
        status: {
          in: ["RUSHES_RECEIVED", "IN_EDIT", "EDIT_REVIEW"],
        },
      },
      select: SLOT_SELECT,
      orderBy: { updatedAt: "desc" },
      take: ITEM_LIMIT_PER_TYPE,
    }),
    // Slots sans vidéaste (statuts shoot).
    prisma.publicationSlot.findMany({
      where: {
        assigneeVideasteId: null,
        status: { in: ["PLANNED", "RUSHES_EXPECTED"] },
      },
      select: SLOT_SELECT,
      orderBy: { scheduledAt: "asc" },
      take: ITEM_LIMIT_PER_TYPE,
    }),
    // Slots sans recette (ni binding, ni recette globale directe).
    // Fix résidu G.3 : le test `patternId = null` comptait à tort les slots
    // recette (patternBindingId non-null, patternId legacy null).
    prisma.publicationSlot.findMany({
      where: {
        patternBindingId: null,
        patternTemplateId: null,
        status: { in: ACTIVE_STATUSES_FOR_OVERDUE },
      },
      select: SLOT_SELECT,
      orderBy: { updatedAt: "desc" },
      take: ITEM_LIMIT_PER_TYPE,
    }),
    // Rushes en retard : RUSHES_EXPECTED + scheduledAt passé.
    prisma.publicationSlot.findMany({
      where: {
        status: "RUSHES_EXPECTED",
        scheduledAt: { lt: now, not: null },
      },
      select: SLOT_SELECT,
      orderBy: { scheduledAt: "asc" },
      take: ITEM_LIMIT_PER_TYPE,
    }),
    // Banque prête à programmer : currentVersionId présent, statut publish-ready, pas de date.
    prisma.publicationSlot.findMany({
      where: {
        scheduledAt: null,
        currentVersionId: { not: null },
        status: { in: ["EDIT_APPROVED", "READY_FOR_CM"] },
      },
      select: SLOT_SELECT,
      orderBy: { updatedAt: "desc" },
      take: ITEM_LIMIT_PER_TYPE,
    }),
    // Tournages DÉCLINÉS — sans plancher de date : un refus sur un tournage
    // déjà passé reste un problème ouvert (personne n'a tourné), et c'est
    // précisément celui qu'il ne faut pas laisser filer.
    prisma.entity.findMany({
      where: {
        type: { hasPlanning: true, visibility: "team" },
        isArchived: false,
        status: "PLANNED",
        assigneeVideasteId: { not: null },
        ...validatedForTeamFilter(),
        videasteConfirmation: "DECLINED",
      },
      select: ENTITY_SELECT,
      orderBy: { updatedAt: "desc" },
      take: ITEM_LIMIT_PER_TYPE,
    }),
    // Tournages SANS RÉPONSE — requête séparée, et non un simple OR, parce que
    // les deux typologies ne pèsent pas pareil : mutualisées sous un unique
    // `take: 20` trié par date, les plus anciennes rempliraient la page et
    // évinceraient les refus, qui sont bien plus urgents.
    //
    // Plancher glissant plutôt que `gte: now` : un tournage passé jamais
    // confirmé disparaissait du radar admin pendant que le bandeau côté
    // vidéaste, lui, continuait de réclamer une réponse. Deux vérités
    // différentes sur la même fiche. La fenêtre borne le rattrapage sans
    // ressusciter un arriéré sans fin.
    prisma.entity.findMany({
      where: {
        type: { hasPlanning: true, visibility: "team" },
        isArchived: false,
        status: "PLANNED",
        scheduledAt: { gte: inboxShootFloor(now) },
        assigneeVideasteId: { not: null },
        ...validatedForTeamFilter(),
        videasteConfirmation: null,
      },
      select: ENTITY_SELECT,
      orderBy: { scheduledAt: "asc" },
      take: ITEM_LIMIT_PER_TYPE,
    }),
  ]);

  // Dédup : un slot peut apparaître dans plusieurs typologies. On garde
  // celle au score le plus haut (la plus urgente).
  const byId = new Map<string, InboxItem>();

  function addItem(
    slot: SlotRaw,
    typology: InboxTypology,
    score: number,
    extra?: Partial<InboxItem>,
  ) {
    const existing = byId.get(slot.id);
    if (existing && existing.score >= score) return;
    byId.set(slot.id, {
      id: slot.id,
      typology,
      score,
      slot: serializeSlot(slot),
      ...extra,
    });
  }

  // Scoring volontairement éloigné pour que la fusion (un slot couvert par 2
  // typologies) garde toujours la plus urgente.
  for (const s of versionReviewSlots) {
    const latest = s.versions[0];
    addItem(s, "version_review", 100, {
      latestVersion: latest
        ? {
            id: latest.id,
            versionNumber: latest.versionNumber,
            createdAt: latest.createdAt.toISOString(),
          }
        : undefined,
    });
  }
  for (const s of overdueSlots) addItem(s, "overdue", 90);
  for (const s of noMonteurSlots) addItem(s, "no_monteur", 80);
  for (const s of noVideasteSlots) addItem(s, "no_videaste", 75);
  for (const s of rushesOverdueSlots) addItem(s, "rushes_overdue", 70);
  for (const s of noPatternSlots) addItem(s, "no_pattern", 40);
  for (const s of bankReadySlots) addItem(s, "bank_ready", 20);

  // Tournages : un vidéaste indisponible bloque la date (score haut, juste
  // sous les retards) ; une absence de réponse est un rappel (score bas).
  const entityItems: InboxItem[] = [
    ...shootDeclinedEntities.map((e) => ({
      id: `entity:${e.id}`,
      typology: "shoot_declined" as const,
      score: 85,
      entity: serializeEntity(e),
    })),
    ...shootUnconfirmedEntities.map((e) => ({
      id: `entity:${e.id}`,
      typology: "shoot_unconfirmed" as const,
      score: 45,
      entity: serializeEntity(e),
    })),
  ];

  const all = [...Array.from(byId.values()), ...entityItems];
  const sortKey = (i: InboxItem) => i.slot?.updatedAt ?? i.entity?.updatedAt ?? "";
  all.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return sortKey(b).localeCompare(sortKey(a));
  });
  return all.slice(0, MAX_TOTAL_ITEMS);
}

/**
 * Compteurs par typologie — calculés depuis le résultat de getInboxItems.
 * Utile pour les badges des tabs filtres.
 */
export function countByTypology(
  items: InboxItem[],
): Record<InboxTypology | "all", number> {
  const counts: Record<string, number> = { all: items.length };
  for (const it of items) {
    counts[it.typology] = (counts[it.typology] ?? 0) + 1;
  }
  return counts as Record<InboxTypology | "all", number>;
}
