import type { Session } from "next-auth";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const IMPERSONATION_COOKIE_NAME = "toolbox_impersonate_user_id";
/**
 * Cookie pour le "view as role" — permet à un ADMIN de basculer sur l'interface
 * d'un autre rôle (VIDEASTE, MONTEUR, CM) en gardant son propre id (donc voit
 * ses propres slots assignés à ce rôle). Distinct de l'impersonation qui change
 * complètement l'id user.
 */
export const VIEW_AS_ROLE_COOKIE_NAME = "toolbox_view_as_role";

const VALID_VIEW_AS_ROLES = new Set(["VIDEASTE", "MONTEUR", "CM"]);

export type AppUserIdentity = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: string;
  permissions: string;
  /** Agence (Client) rattachée — comptes externes bons de commande. */
  clientId?: string | null;
};

export type UserContext = {
  session: Session;
  actualUser: AppUserIdentity;
  effectiveUser: AppUserIdentity;
  isAdmin: boolean;
  isImpersonating: boolean;
  /**
   * True quand un ADMIN a basculé en vue "comme un autre rôle" via le switch
   * navbar. effectiveUser.id reste celui de l'admin, mais effectiveUser.role
   * est forcé (et canAdminBypass devient false pour simuler la vraie interface).
   */
  isRoleOverride: boolean;
  canAdminBypass: boolean;
};

function getSessionUserIdentity(session: Session): AppUserIdentity {
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
    permissions: session.user.permissions ?? "[]",
    clientId: session.user.clientId ?? null,
  };
}

export async function resolveUserContext(
  session: Session,
  impersonatedUserId?: string | null,
  viewAsRole?: string | null
): Promise<UserContext> {
  const actualUser = getSessionUserIdentity(session);
  const isAdmin = actualUser.role === "ADMIN";

  // Impersonation prime sur view-as-role (cas où les 2 cookies coexistent).
  if (isAdmin && impersonatedUserId && impersonatedUserId !== actualUser.id) {
    const impersonatedUser = await prisma.user.findUnique({
      where: { id: impersonatedUserId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        clientId: true,
      },
    });
    if (impersonatedUser && impersonatedUser.role !== "ADMIN") {
      return {
        session,
        actualUser,
        effectiveUser: {
          id: impersonatedUser.id,
          name: impersonatedUser.name,
          email: impersonatedUser.email,
          role: impersonatedUser.role,
          permissions: impersonatedUser.permissions,
          clientId: impersonatedUser.clientId,
        },
        isAdmin,
        isImpersonating: true,
        isRoleOverride: false,
        canAdminBypass: false,
      };
    }
  }

  // View-as-role : admin garde son id mais effectiveUser.role est overridé.
  if (isAdmin && viewAsRole && VALID_VIEW_AS_ROLES.has(viewAsRole)) {
    return {
      session,
      actualUser,
      effectiveUser: { ...actualUser, role: viewAsRole },
      isAdmin,
      isImpersonating: false,
      isRoleOverride: true,
      canAdminBypass: false,
    };
  }

  // Mode normal (admin ou autre rôle, sans override actif)
  return {
    session,
    actualUser,
    effectiveUser: actualUser,
    isAdmin,
    isImpersonating: false,
    isRoleOverride: false,
    canAdminBypass: isAdmin,
  };
}

export async function getUserContext(): Promise<UserContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const cookieStore = await cookies();
  const impersonatedUserId = cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value ?? null;
  const viewAsRole = cookieStore.get(VIEW_AS_ROLE_COOKIE_NAME)?.value ?? null;
  return resolveUserContext(session, impersonatedUserId, viewAsRole);
}

// parsePermissions a été déplacée dans lib/permissions/parsePermissions.ts
// (helper neutre client + server). Le re-export ci-dessous évite de casser
// les imports existants.
export { parsePermissions } from "@/lib/permissions/parsePermissions";