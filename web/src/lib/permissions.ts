import { prisma } from "@/lib/prisma";
import { ROLE_TOOL_SCOPE, ROLE_TOOL_SCOPE_ALL } from "@/lib/permissions/tools";
import type { UserRole } from "@/types/roles";

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
  BRIEF:         "brief",
  MISSION:       "mission",
} as const;

export type Tool = (typeof TOOLS)[keyof typeof TOOLS];

export const TOOL_LABELS: Record<Tool, string> = {
  templates:     "Templates et générations",
  captions:      "Sous-titres vidéo",
  covers:        "Générateur de covers",
  transcription: "Transcription audio/vidéo",
  description:   "Générateur de descriptions",
  brief:         "Briefs monteur",
  mission:       "Lancer une mission",
};

export const TOOL_DESCRIPTIONS: Record<Tool, string> = {
  templates:     "Accès à la page Templates et génération d'images, PDF et vidéos",
  captions:      "Accès à l'outil de sous-titres vidéo avec import et incrustation",
  covers:        "Extraction de frames depuis une vidéo pour choisir une cover idéale",
  transcription: "Transcription automatique de fichiers audio/vidéo avec identification des intervenants",
  description:   "Génération de descriptions texte à partir d'un fichier SRT ou d'une transcription",
  brief:         "Génération de briefs de montage à partir d'une transcription et d'un prompt dédié",
  mission:       "Créer une mission depuis une recette (compte Instagram optionnel) et générer",
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

/** Retourne les outils d'un user. ADMIN -> tous les outils.
 *  Combine ROLE_TOOL_SCOPE (default rôle) + User.permissions JSON (granularité). */
export async function getUserTools(userId: string): Promise<Tool[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, permissions: true },
  });
  if (!user) return [];
  if (user.role === "ADMIN") return Object.values(TOOLS);
  const role = user.role as UserRole;
  const roleScope = ROLE_TOOL_SCOPE[role] ?? [];
  let individual: Tool[] = [];
  try {
    individual = JSON.parse(user.permissions) as Tool[];
  } catch {
    individual = [];
  }
  if (roleScope === ROLE_TOOL_SCOPE_ALL) return Object.values(TOOLS);
  const fromRole = (roleScope as readonly string[]).filter((t): t is Tool =>
    Object.values(TOOLS).includes(t as Tool),
  );
  return Array.from(new Set([...fromRole, ...individual]));
}

/** Verifie si un user a acces a un outil.
 *  ADMIN -> toujours true.
 *  CM/MONTEUR -> outils du rôle (ROLE_TOOL_SCOPE) OU outils individuels (permissions JSON).
 *  EXTERNAL_GENERATOR/USER -> outils individuels uniquement.
 *
 *  Avant ce fix, hasTool consultait uniquement permissions JSON, ce qui bloquait
 *  silencieusement CM/MONTEUR sur tous leurs outils par défaut (captions, transcription,
 *  description, cover) sauf si un admin avait ajouté manuellement la perm. */
export async function hasTool(userId: string, tool: Tool): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, permissions: true },
  });
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const role = user.role as UserRole;
  const roleScope = ROLE_TOOL_SCOPE[role] ?? [];
  if (roleScope === ROLE_TOOL_SCOPE_ALL) return true;
  if ((roleScope as readonly string[]).includes(tool)) return true;
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