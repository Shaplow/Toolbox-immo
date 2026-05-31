/**
 * Helper pur (pas d'accès DB ni React) qui résout la "prochaine action
 * attendue" pour un slot donné — qui doit faire quoi.
 *
 * Centralise la logique consommée par :
 *  - NextActionBanner (filtré "isMine") : affiche "À toi : X" en haut de fiche.
 *  - SlotDetailPanel (drawer admin) : affiche "Prochaine action : Y par Z"
 *    pour que l'admin sache d'un coup d'œil ce qui est attendu et de qui.
 *  - AddSlotModal toast post-création : confirme à l'admin ce qui va se
 *    passer ensuite.
 *
 * Avant Phase 3 : seule la version "isMine" existait dans NextActionBanner
 * — l'admin qui supervisait n'avait aucune info équivalente côté drawer
 * (Friction HIGH #3 du audit UX 2026-05-31).
 */

import { NEXT_ACTION, OWNER_LABEL, type SlotStatus } from "@/types/calendar";
import { resolveSlotOwner } from "@/lib/slots/statusLabels";

export interface NextActionAssignees {
  assigneeMonteurId?: string | null;
  assigneeCmId?: string | null;
  assigneeVideasteId?: string | null;
  assigneeMonteurName?: string | null;
  assigneeCmName?: string | null;
  assigneeVideasteName?: string | null;
}

export interface NextActionInfo {
  /** Phrase courte décrivant l'action attendue, en français. */
  action: string;
  /** Rôle responsable de l'action ("MONTEUR" | "CM" | "VIDEASTE" | "ADMIN"). */
  ownerRole: "MONTEUR" | "CM" | "VIDEASTE" | "ADMIN";
  /** Label FR du rôle ("Monteur", "CM", "Vidéaste", "Admin"). */
  ownerLabel: string;
  /** Nom de l'utilisateur assigné s'il existe (pour personnaliser le message). */
  assigneeName: string | null;
}

/**
 * @returns null si le statut n'a pas d'action mappée (DRAFT, terminaux, etc.)
 *          ou si l'owner ne peut pas être résolu.
 */
export function resolveNextActionInfo(
  slotStatus: string,
  assignees: NextActionAssignees,
): NextActionInfo | null {
  const owner = resolveSlotOwner({
    status: slotStatus,
    assigneeVideasteId: assignees.assigneeVideasteId ?? null,
  });
  if (!owner) return null;

  const action = NEXT_ACTION[slotStatus as SlotStatus] ?? null;
  if (!action) return null;

  let assigneeName: string | null = null;
  if (owner === "MONTEUR") assigneeName = assignees.assigneeMonteurName ?? null;
  else if (owner === "CM") assigneeName = assignees.assigneeCmName ?? null;
  else if (owner === "VIDEASTE")
    assigneeName = assignees.assigneeVideasteName ?? null;

  return {
    action,
    ownerRole: owner,
    ownerLabel: OWNER_LABEL[owner],
    assigneeName,
  };
}

/**
 * Formate la phrase complète "Action attendue par X" prête à afficher.
 * Si pas d'action mappée → null (caller doit gérer le fallback).
 */
export function formatNextActionLine(
  slotStatus: string,
  assignees: NextActionAssignees,
): string | null {
  const info = resolveNextActionInfo(slotStatus, assignees);
  if (!info) return null;
  const who = info.assigneeName
    ? `${info.ownerLabel} ${info.assigneeName}`
    : info.ownerLabel;
  return `${info.action} — ${who}`;
}
