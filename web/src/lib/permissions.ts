import { prisma } from "@/lib/prisma";

/**
 * Outils disponibles dans la Toolbox Immo.
 *
 * ADMIN -> tous les outils automatiquement.
 * USER  -> outils assignes individuellement par l'admin.
 *
 * Stocke dans User.permissions (JSON array), ex: ["templates","captions"]
 */
export const TOOLS = {
  TEMPLATES: "templates",
  CAPTIONS:  "captions",
} as const;

export type Tool = (typeof TOOLS)[keyof typeof TOOLS];

export const TOOL_LABELS: Record<Tool, string> = {
  templates: "Templates & generation",
  captions:  "Outil Captions (videos)",
};

export const TOOL_DESCRIPTIONS: Record<Tool, string> = {
  templates: "Acces a la page Templates, generation d'images / PDF / videos",
  captions:  "Acces a /tools/captions - upload video + burn sous-titres",
};

// -- Helpers -------------------------------------------------------------------

/** Retourne les outils d'un user. ADMIN -> tous les outils. */
export async function getUserTools(userId: string): Promise<Tool[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, permissions: true },
  });
  if (!user) return [];
  if (user.role === "ADMIN") return Object.values(TOOLS);
  try {
    return JSON.parse(user.permissions) as Tool[];
  } catch {
    return [];
  }
}

/** Verifie si un user a acces a un outil. ADMIN -> toujours true. */
export async function hasTool(userId: string, tool: Tool): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, permissions: true },
  });
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  try {
    const tools = JSON.parse(user.permissions) as Tool[];
    return tools.includes(tool);
  } catch {
    return false;
  }
}

/** Met a jour les outils d'un utilisateur. */
export async function setUserTools(userId: string, tools: Tool[]): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { permissions: JSON.stringify(tools) },
  });
}

/** True si un user peut acceder a un template (proprietaire, acces accorde, ou admin). */
export async function canAccessTemplate(
  userId: string,
  templateId: string,
  role?: string
): Promise<boolean> {
  if (role === "ADMIN") return true;
  const access = await prisma.templateAccess.findUnique({
    where: { userId_templateId: { userId, templateId } },
  });
  return access !== null;
}