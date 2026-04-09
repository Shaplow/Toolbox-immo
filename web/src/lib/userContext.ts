import type { Session } from "next-auth";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const IMPERSONATION_COOKIE_NAME = "toolbox_impersonate_user_id";

export type AppUserIdentity = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: string;
  permissions: string;
};

export type UserContext = {
  session: Session;
  actualUser: AppUserIdentity;
  effectiveUser: AppUserIdentity;
  isAdmin: boolean;
  isImpersonating: boolean;
  canAdminBypass: boolean;
};

function getSessionUserIdentity(session: Session): AppUserIdentity {
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
    permissions: session.user.permissions ?? "[]",
  };
}

export async function resolveUserContext(
  session: Session,
  impersonatedUserId?: string | null
): Promise<UserContext> {
  const actualUser = getSessionUserIdentity(session);
  const isAdmin = actualUser.role === "ADMIN";

  if (!isAdmin || !impersonatedUserId || impersonatedUserId === actualUser.id) {
    return {
      session,
      actualUser,
      effectiveUser: actualUser,
      isAdmin,
      isImpersonating: false,
      canAdminBypass: isAdmin,
    };
  }

  const impersonatedUser = await prisma.user.findUnique({
    where: { id: impersonatedUserId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      permissions: true,
    },
  });

  if (!impersonatedUser || impersonatedUser.role === "ADMIN") {
    return {
      session,
      actualUser,
      effectiveUser: actualUser,
      isAdmin,
      isImpersonating: false,
      canAdminBypass: isAdmin,
    };
  }

  return {
    session,
    actualUser,
    effectiveUser: {
      id: impersonatedUser.id,
      name: impersonatedUser.name,
      email: impersonatedUser.email,
      role: impersonatedUser.role,
      permissions: impersonatedUser.permissions,
    },
    isAdmin,
    isImpersonating: true,
    canAdminBypass: false,
  };
}

export async function getUserContext(): Promise<UserContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const cookieStore = await cookies();
  const impersonatedUserId = cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value ?? null;
  return resolveUserContext(session, impersonatedUserId);
}

export function parsePermissions(rawPermissions: string | null | undefined): string[] {
  try {
    return JSON.parse(rawPermissions ?? "[]") as string[];
  } catch {
    return [];
  }
}