/**
 * Le regroupement de la banque — « on met des étiquettes sur ce qui est en
 * attente de rushs, en cours de montage, etc ».
 *
 * Extrait de `BankView` (la vue plein écran supprimée) pour vivre à côté de
 * `bankReady` : c'est la taxonomie de la banque, pas un détail d'un composant.
 * Module PUR, donc testable sans rendu — et c'est ce qui permet de vérifier
 * qu'aucun statut ne tombe dans un trou.
 */

import type { SlotStatus } from "@/types/calendar";

export type BankGroupKey = "ready" | "review" | "wip" | "todo";

export interface BankGroup {
  key: BankGroupKey;
  label: string;
  hint: string;
  statuses: SlotStatus[];
}

/**
 * Quatre groupes, dans l'ordre d'utilité pour celui qui place : ce qui est
 * livrable d'abord, ce qui n'a pas encore commencé en dernier.
 *
 * Pas de groupe « validation client » : `AWAITING_CLIENT` / `CLIENT_REVISION`
 * sont rares hors workflow client complet et créaient une section
 * structurellement vide.
 */
export const BANK_GROUPS: BankGroup[] = [
  {
    key: "ready",
    label: "Prêtes à programmer",
    hint: "Montage validé — il ne manque qu'une date.",
    statuses: ["EDIT_APPROVED", "READY_FOR_CM"],
  },
  {
    key: "review",
    label: "Montage à valider",
    hint: "Une nouvelle version a été livrée.",
    statuses: ["EDIT_REVIEW"],
  },
  {
    key: "wip",
    label: "En montage",
    hint: "Le monteur est sur le coup.",
    statuses: ["IN_EDIT", "RUSHES_RECEIVED", "IN_PROGRESS"],
  },
  {
    key: "todo",
    label: "À démarrer",
    hint: "Créée, en attente de rushs ou d'une première action.",
    statuses: ["RUSHES_EXPECTED", "PLANNED", "DRAFT"],
  },
];

/** Fond de section par groupe — l'accent le plus fort sur ce qui est livrable. */
export const BANK_GROUP_BG: Record<BankGroupKey, string> = {
  ready: "bg-info-50",
  review: "bg-warning-50",
  wip: "bg-stone-50",
  todo: "bg-muted",
};

/**
 * Répartit des publications dans les groupes, en préservant leur ordre.
 *
 * Les statuts hors taxonomie (une publication annulée restée sans date, par
 * exemple) atterrissent dans `rest` plutôt que d'être avalés en silence : la
 * banque doit montrer tout ce qu'elle contient, c'est sa raison d'être.
 */
export function partitionBank<T extends { status: SlotStatus }>(
  slots: T[],
): { groups: { group: BankGroup; slots: T[] }[]; rest: T[] } {
  const seen = new Set<T>();
  const groups = BANK_GROUPS.map((group) => {
    const matched = slots.filter((s) => group.statuses.includes(s.status));
    for (const s of matched) seen.add(s);
    return { group, slots: matched };
  });
  return { groups, rest: slots.filter((s) => !seen.has(s)) };
}
