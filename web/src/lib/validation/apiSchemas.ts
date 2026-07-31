/**
 * apiSchemas — schemas Zod centralisés pour les API routes critiques.
 *
 * Ticket E5 du plan recentré. Avant Zod, les routes faisaient des
 * vérifications ad-hoc (typeof === "string", trim().length, etc.) qui
 * étaient incohérentes et couvraient mal les edge cases (null vs
 * undefined, types mixed, dates invalides…). Ce module centralise les
 * schemas réutilisables pour les routes sensibles (mass-assignment,
 * race condition, decisions admin).
 *
 * Convention :
 * - 1 export par schema, suffixe `Schema`.
 * - Préférer `.strict()` (rejette les clés inconnues) pour bloquer
 *   les mass-assignment.
 * - Préférer `.transform()` pour normaliser (trim, lowercase) plutôt
 *   que de laisser le call site le faire.
 *
 * Helper : `validateBody(req, schema)` parse le JSON puis applique le
 * schema et retourne `{ success, data, error }`. Évite la duplication
 * du try/catch dans chaque route.
 */

import { z } from "zod";

const MAX_TEXT_FIELD = 5000;

/**
 * POST /api/admin/jobs/mark-failed
 * Marque un job comme FAILED. type doit être un literal connu, id un cuid.
 */
export const markJobFailedSchema = z.object({
  type: z.enum(["render", "caption", "transcription", "description", "cover-pack", "autocut"]),
  id: z.string().min(1).max(255),
}).strict();

/**
 * POST /api/publications/[id]/comments
 * Ajoute un commentaire textuel à une publication. body limit raisonnable.
 */
export const publicationCommentSchema = z.object({
  body: z.string().trim().min(1, "Le commentaire ne peut pas être vide.").max(MAX_TEXT_FIELD),
}).strict();

/**
 * PATCH /api/calendar/slots/[id]
 * Mass-assignment guard — seuls les champs whitelist passent. Les autres
 * (assignees, scheduledAt, accountId, etc.) restent sur l'ancienne route
 * legacy pour l'instant — à migrer dans une itération future.
 */
export const slotPatchSafeSchema = z.object({
  notes: z.string().trim().max(MAX_TEXT_FIELD).optional().nullable(),
  description: z.string().trim().max(MAX_TEXT_FIELD).optional().nullable(),
  caption: z.string().trim().max(MAX_TEXT_FIELD).optional().nullable(),
  status: z.string().min(1).max(50).optional(),
}).strict().refine((obj) => Object.keys(obj).length > 0, {
  message: "Au moins un champ doit être fourni.",
});

/**
 * PATCH /api/admin/clients/[id]
 * Mise à jour des infos de contact d'un client.
 */
export const clientPatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  contactName: z.string().trim().max(255).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
}).strict();

/**
 * Helper unique pour parser + valider le body d'une route avec un schema.
 *
 * Usage :
 * ```ts
 * const parsed = await validateBody(req, markJobFailedSchema);
 * if (!parsed.success) {
 *   return NextResponse.json({ error: parsed.error }, { status: 400 });
 * }
 * const { type, id } = parsed.data;
 * ```
 */
export async function validateBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ success: true; data: z.infer<T> } | { success: false; error: string }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { success: false, error: "Body JSON invalide" };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.join(".") ?? "";
    const message = first?.message ?? "Validation échouée";
    return { success: false, error: path ? `${path}: ${message}` : message };
  }
  return { success: true, data: result.data };
}
