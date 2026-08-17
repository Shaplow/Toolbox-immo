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

import { prisma } from "@/lib/prisma";
import type { SlotStatus } from "@/types/roles";

export type InboxTypology =
  | "version_review" // EDIT_REVIEW avec version pending
  | "overdue" // scheduledAt < now & non-terminal
  | "no_monteur" // sans monteur assigné
  | "no_videaste" // sans vidéaste assigné
  | "no_pattern" // sans recette
  | "rushes_overdue" // RUSHES_EXPECTED & scheduledAt < now
  | "bank_ready"; // banque prête à programmer

export interface InboxItem {
  id: string;
  typology: InboxTypology;
  score: number;
  slot: {
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
const MAX_TOTAL_ITEMS = 60;

// Statuts considérés "actifs" (en cours, non terminés).
const ACTIVE_STATUSES_FOR_OVERDUE: SlotStatus[] = [
  "PLANNED",
  "RUSHES_EXPECTED",
  "RUSHES_RECEIVED",
  "IN_EDIT",
  "EDIT_REVIEW",
  "EDIT_APPROVED",
  "CAPTIONS_PENDING",
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
    patternLabel:
      s.patternBinding?.customLabel ??
      s.patternBinding?.patternTemplate?.label ??
      s.patternTemplate?.label ??
      null,
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
          in: ["RUSHES_RECEIVED", "IN_EDIT", "EDIT_REVIEW", "CAPTIONS_PENDING"],
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
        status: { in: ["EDIT_APPROVED", "READY_FOR_CM", "CAPTIONS_PENDING"] },
      },
      select: SLOT_SELECT,
      orderBy: { updatedAt: "desc" },
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

  const all = Array.from(byId.values());
  all.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.slot.updatedAt.localeCompare(a.slot.updatedAt);
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
