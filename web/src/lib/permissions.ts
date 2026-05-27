import { prisma } from "@/lib/prisma";

/**
 * Outils disponibles dans la Toolbox Immo.
 *
 * ADMIN              -> tous les outils automatiquement.
 * EXTERNAL_GENERATOR -> outils assignés individuellement par l'admin (anciennement USER).
 *
 * Stocké dans User.permissions (JSON array), ex: ["templates","captions"]
 */
export const TOOLS = {
  TEMPLATES:     "templates",
  CAPTIONS:      "captions",
  COVERS:        "covers",
  TRANSCRIPTION: "transcription",
  DESCRIPTION:   "description",
} as const;

export type Tool = (typeof TOOLS)[keyof typeof TOOLS];

export const TOOL_LABELS: Record<Tool, string> = {
  templates:     "Templates et générations",
  captions:      "Sous-titres vidéo",
  covers:        "Générateur de covers",
  transcription: "Transcription audio/vidéo",
  description:   "Générateur de descriptions",
};

export const TOOL_DESCRIPTIONS: Record<Tool, string> = {
  templates:     "Accès à la page Templates et génération d'images, PDF et vidéos",
  captions:      "Accès à l'outil de sous-titres vidéo avec import et incrustation",
  covers:        "Extraction de frames depuis une vidéo pour choisir une cover idéale",
  transcription: "Transcription automatique de fichiers audio/vidéo avec identification des intervenants",
  description:   "Génération de descriptions texte à partir d'un fichier SRT ou d'une transcription",
};

/**
 * Outils que le rôle EXTERNAL_GENERATOR (client externe, anciennement USER)
 * peut se voir attribuer. Ce rôle n'est pas un membre d'équipe et n'a donc
 * pas vocation à générer captions/transcription/description.
 *
 * Utilisé par UsersPanel (filtre les checkboxes) et par PATCH
 * /api/admin/users/[id] (refuse d'ajouter une perm non-autorisée).
 *
 * Note : les perms déjà actives héritées d'avant cette restriction restent
 * toggleables vers OFF (pour permettre le nettoyage manuel), mais on ne
 * peut plus en ajouter de nouvelles.
 */
export const EXTERNAL_GENERATOR_ALLOWED_TOOLS: readonly Tool[] = [TOOLS.TEMPLATES, TOOLS.COVERS];

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