/**
 * Schémas zod des routes du lien d'export — une seule définition, importée par
 * les routes (admin et publiques) et par les tests. Un fichier route Next ne
 * peut pas exporter d'autres symboles : sans ce module, les schémas restaient
 * dupliqués et intestables, et le contrat « corps POST du tiroir ↔ route »
 * n'était couvert que par l'e2e.
 */

import { z } from "zod";
import { EXPORT_LINK_DURATIONS_DAYS, type ExportLinkDurationDays } from "./types";

export const exportLinkDurationSchema = z
  .number()
  .int()
  .refine((d): d is ExportLinkDurationDays => (EXPORT_LINK_DURATIONS_DAYS as readonly number[]).includes(d), {
    message: "Durée non proposée",
  });

const ids = (max: number) => z.array(z.string().min(1).max(64)).max(max);

/** POST /api/admin/clients/[id]/export-links */
export const createExportLinkSchema = z
  .object({
    label: z.string().trim().max(120).nullable().optional(),
    expiresInDays: exportLinkDurationSchema,
    accountIds: ids(200).min(1, "Coche au moins un compte"),
    mediaLibraryIds: ids(500),
    dataLibraryIds: ids(500),
    includePublications: z.boolean(),
  })
  .strict()
  .refine((b) => b.mediaLibraryIds.length + b.dataLibraryIds.length > 0 || b.includePublications, {
    message: "Coche au moins un contenu",
  });

/** PATCH /api/admin/clients/[id]/export-links/[linkId] */
export const exportLinkActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke") }).strict(),
  z.object({ action: z.literal("rotate") }).strict(),
  z.object({ action: z.literal("extend"), days: exportLinkDurationSchema }).strict(),
]);

/** POST /api/export/[token]/urls */
export const exportUrlsSchema = z
  .object({
    refs: z.array(z.string().min(1).max(200)).min(1).max(20),
  })
  .strict();

const count = z.number().int().min(0).max(10_000_000);

/** POST /api/export/[token]/events */
export const exportEventSchema = z
  .object({
    type: z.enum(["started", "completed", "stopped"]),
    files: count,
    // Octets d'une session : borné à 100 To, largement au-dessus d'un export réel.
    bytes: z.number().int().min(0).max(1e14),
    skipped: count,
    failed: count,
    missing: count,
  })
  .strict();
