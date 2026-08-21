/**
 * Scoping des bons de commande (Order) par rôle — miroir d'entityScope.
 *
 *  - ADMIN : tout.
 *  - EXTERNAL_GENERATOR : les commandes de SON client (user.clientId). Sans
 *    client rattaché → aucun accès (`__never__`).
 *  - VIDEASTE / MONTEUR / CM : aucun accès — l'équipe travaille sur les
 *    fiches et les publications, pas sur les commandes.
 *
 * Le lien User↔Client est porté par la session (refresh JWT ≤5 min, comme le
 * rôle) ; les routes sensibles re-vérifient côté service quand nécessaire.
 */

import type { Prisma } from "@prisma/client";
import type { UserRole } from "@/types/roles";

/** Un externe peut voir l'espace commandes s'il a un client rattaché. */
export function canSeeOrders(role: UserRole, clientId: string | null | undefined): boolean {
  if (role === "ADMIN") return true;
  return role === "EXTERNAL_GENERATOR" && !!clientId;
}

/** Where clause Prisma scopant `Order` pour un user donné. */
export function whereClauseForUserOrder(
  role: UserRole,
  clientId: string | null | undefined,
): Prisma.OrderWhereInput {
  switch (role) {
    case "ADMIN":
      return {};
    case "EXTERNAL_GENERATOR":
      return clientId ? { clientId } : { id: "__never__" };
    default:
      return { id: "__never__" };
  }
}

/** Check single-resource — même logique que la where clause. */
export function canUserAccessOrder(
  order: { clientId: string },
  role: UserRole,
  clientId: string | null | undefined,
): boolean {
  if (role === "ADMIN") return true;
  if (role !== "EXTERNAL_GENERATOR") return false;
  return !!clientId && order.clientId === clientId;
}
