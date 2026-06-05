/**
 * resolveSlotContext — helper d'auth pour les routes /api/publications/[id]/*.
 *
 * Auparavant, 12+ routes répétaient le même bloc :
 *   - getUserContext()
 *   - early return 401 si pas de session
 *   - toUserRole(effectiveUser.role)
 *   - findUnique slot avec un select assignee minimal
 *   - canUserAccessSlot check
 *   - early return 404 si refus
 *
 * Le select assignee divergeait subtilement d'une route à l'autre (certaines
 * incluaient `assigneeVideasteId`, d'autres non) — ajouter un nouveau field
 * d'accès (ex: assigneeExternalId) aurait demandé 12 éditions parallèles.
 *
 * Ce helper centralise le pattern. Les routes en sortent en ~3 lignes au lieu
 * de ~10-15.
 *
 * Retourne `null` quand l'auth fail (la route renvoie 401) ou que l'accès est
 * refusé (la route renvoie 404, anti-énumération).
 */

import { prisma } from "@/lib/prisma";
import { getUserContext, type UserContext } from "@/lib/userContext";
import { canUserAccessSlot } from "@/lib/permissions/slotScope";
import { toUserRole } from "@/lib/permissions/role";
import type { UserRole } from "@/types/roles";

/** Champs du slot strictement nécessaires à canUserAccessSlot — minimal pour
 *  ne pas alourdir les queries. Une route qui a besoin de plus de fields refait
 *  un findUnique avec ses propres includes après ce check. */
export interface ResolvedSlotMinimal {
  id: string;
  status: string;
  assigneeMonteurId: string | null;
  assigneeCmId: string | null;
  assigneeVideasteId: string | null;
}

export interface SlotContext {
  /** UserContext résolu (session + effective/actual users). */
  userContext: UserContext;
  /** Slot minimal résolu — utiliser pour les checks supplémentaires si besoin. */
  slot: ResolvedSlotMinimal;
  /** Rôle effectif normalisé. */
  role: UserRole;
  /** effectiveUser.id (= userId scopé sous impersonation). */
  userId: string;
}

export type SlotContextResult =
  | { status: "ok"; ctx: SlotContext }
  | { status: 401 }
  | { status: 404 };

/**
 * Résout le contexte slot + auth pour une route /api/publications/[id]/*.
 *
 * Usage :
 *   const r = await resolveSlotContext(slotId);
 *   if (r.status === 401) return NextResponse.json({ error: "..." }, { status: 401 });
 *   if (r.status === 404) return NextResponse.json({ error: "..." }, { status: 404 });
 *   const { userContext, slot, role, userId } = r.ctx;
 */
export async function resolveSlotContext(slotId: string): Promise<SlotContextResult> {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id) {
    return { status: 401 };
  }

  const role = toUserRole(userContext.effectiveUser.role);
  const userId = userContext.effectiveUser.id;

  const slot = await prisma.publicationSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      status: true,
      assigneeMonteurId: true,
      assigneeCmId: true,
      assigneeVideasteId: true,
    },
  });

  if (!slot || !canUserAccessSlot(slot, role, userId)) {
    return { status: 404 };
  }

  return { status: "ok", ctx: { userContext, slot, role, userId } };
}
