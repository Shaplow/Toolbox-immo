/**
 * Liens de téléchargement des données d'un client — cycle de vie.
 *
 * Calqué sur ClientValidationToken (lib/publications/clientValidation.ts) :
 * jeton de 256 bits, seul son sha256 est stocké, le brut n'est renvoyé qu'à la
 * création ou à la rotation. Contrairement à la validation, plusieurs liens
 * peuvent coexister (sélections différentes) et un lien sert plusieurs fois
 * pendant sa validité (reprise d'un téléchargement de 150 Go).
 */

import { randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/publications/clientValidation";
import type {
  ExportEventRequest,
  ExportLinkDurationDays,
  ExportLinkStatus,
  ExportLinkSummary,
  ExportReport,
  ExportSelection,
} from "@/lib/clientExport/types";

const TOKEN_BYTES = 32;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Forme d'un jeton émis : 64 caractères hexadécimaux. */
const RAW_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

// ─── Statut et résumé ─────────────────────────────────────────────────────────

export function exportLinkStatus(
  link: { expiresAt: Date; revokedAt: Date | null },
  now: Date = new Date(),
): ExportLinkStatus {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

const SUMMARY_SELECT = {
  id: true,
  clientId: true,
  label: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  accountIds: true,
  mediaLibraryIds: true,
  dataLibraryIds: true,
  includePublications: true,
  firstOpenedAt: true,
  lastOpenedAt: true,
  downloadStartedAt: true,
  downloadCompletedAt: true,
  startCount: true,
  lastReport: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ClientExportLinkSelect;

type LinkRow = Prisma.ClientExportLinkGetPayload<{ select: typeof SUMMARY_SELECT }>;

function parseReport(value: Prisma.JsonValue | null): ExportReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return {
    files: num(v.files),
    bytes: num(v.bytes),
    skipped: num(v.skipped),
    failed: num(v.failed),
    missing: num(v.missing),
  };
}

function toSummary(
  row: LinkRow,
  audioLibraryIds: ReadonlySet<string>,
  now: Date,
): ExportLinkSummary {
  const audio = row.mediaLibraryIds.filter((id) => audioLibraryIds.has(id)).length;
  return {
    id: row.id,
    label: row.label,
    status: exportLinkStatus(row, now),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdBy: row.createdBy ? { id: row.createdBy.id, name: row.createdBy.name } : null,
    accountIds: row.accountIds,
    libraries: {
      video: row.mediaLibraryIds.length - audio,
      audio,
      data: row.dataLibraryIds.length,
    },
    includePublications: row.includePublications,
    firstOpenedAt: row.firstOpenedAt?.toISOString() ?? null,
    lastOpenedAt: row.lastOpenedAt?.toISOString() ?? null,
    downloadStartedAt: row.downloadStartedAt?.toISOString() ?? null,
    downloadCompletedAt: row.downloadCompletedAt?.toISOString() ?? null,
    startCount: row.startCount,
    lastReport: parseReport(row.lastReport),
  };
}

async function audioLibrarySet(mediaLibraryIds: string[]): Promise<Set<string>> {
  if (mediaLibraryIds.length === 0) return new Set();
  const audio = await prisma.mediaLibrary.findMany({
    where: { id: { in: [...new Set(mediaLibraryIds)] }, type: "audio" },
    select: { id: true },
  });
  return new Set(audio.map((l) => l.id));
}

async function summarize(rows: LinkRow[]): Promise<ExportLinkSummary[]> {
  const audio = await audioLibrarySet(rows.flatMap((r) => r.mediaLibraryIds));
  const now = new Date();
  return rows.map((row) => toSummary(row, audio, now));
}

// ─── Lecture admin ────────────────────────────────────────────────────────────

export async function listExportLinks(clientId: string): Promise<ExportLinkSummary[]> {
  const rows = await prisma.clientExportLink.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    select: SUMMARY_SELECT,
  });
  return summarize(rows);
}

// ─── Création / rotation / prolongation / révocation ──────────────────────────

function newToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
  return { rawToken, tokenHash: hashToken(rawToken) };
}

export async function createExportLink(input: {
  selection: ExportSelection;
  label: string | null;
  expiresInDays: ExportLinkDurationDays;
  createdByUserId: string;
}): Promise<{ link: ExportLinkSummary; rawToken: string }> {
  const { rawToken, tokenHash } = newToken();
  const row = await prisma.clientExportLink.create({
    data: {
      clientId: input.selection.clientId,
      tokenHash,
      label: input.label,
      accountIds: input.selection.accountIds,
      mediaLibraryIds: input.selection.mediaLibraryIds,
      dataLibraryIds: input.selection.dataLibraryIds,
      includePublications: input.selection.includePublications,
      expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
      createdByUserId: input.createdByUserId,
    },
    select: SUMMARY_SELECT,
  });
  const [link] = await summarize([row]);
  return { link, rawToken };
}

export type ExportLinkMutation =
  | { action: "revoke" }
  | { action: "rotate" }
  | { action: "extend"; days: ExportLinkDurationDays };

export type ExportLinkMutationResult =
  | { ok: true; link: ExportLinkSummary; rawToken?: string }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Révoquer est idempotent. Rotation et prolongation sont refusées sur un lien
 * révoqué (409) : un lien révoqué ne revient pas, on en crée un autre.
 */
export async function mutateExportLink(
  clientId: string,
  linkId: string,
  mutation: ExportLinkMutation,
): Promise<ExportLinkMutationResult> {
  const current = await prisma.clientExportLink.findFirst({
    where: { id: linkId, clientId },
    select: { id: true, expiresAt: true, revokedAt: true },
  });
  if (!current) return { ok: false, status: 404, error: "Lien introuvable" };

  if (mutation.action !== "revoke" && current.revokedAt) {
    return { ok: false, status: 409, error: "Ce lien a été révoqué : crée un nouveau lien." };
  }

  let rawToken: string | undefined;
  let data: Prisma.ClientExportLinkUpdateInput;
  switch (mutation.action) {
    case "revoke":
      data = { revokedAt: current.revokedAt ?? new Date() };
      break;
    case "rotate": {
      const token = newToken();
      rawToken = token.rawToken;
      data = { tokenHash: token.tokenHash };
      break;
    }
    case "extend": {
      const base = Math.max(Date.now(), current.expiresAt.getTime());
      data = { expiresAt: new Date(base + mutation.days * DAY_MS) };
      break;
    }
  }

  const row = await prisma.clientExportLink.update({
    where: { id: current.id },
    data,
    select: SUMMARY_SELECT,
  });
  const [link] = await summarize([row]);
  return { ok: true, link, rawToken };
}

// ─── Vérification côté public ─────────────────────────────────────────────────

export interface VerifiedExportLink {
  id: string;
  clientId: string;
  clientName: string;
  expiresAt: Date;
  selection: ExportSelection;
  firstOpenedAt: Date | null;
}

export type ExportTokenVerification =
  | { valid: true; link: VerifiedExportLink }
  | { valid: false; reason: "not_found" | "expired" | "revoked" };

/**
 * Vérifie un jeton brut. Les raisons sont distinguées pour la page publique
 * (« lien expiré » vs « lien désactivé ») ; les API publiques répondent un 404
 * générique quelle que soit la raison.
 */
export async function verifyExportToken(rawToken: string): Promise<ExportTokenVerification> {
  if (!RAW_TOKEN_PATTERN.test(rawToken)) return { valid: false, reason: "not_found" };

  const row = await prisma.clientExportLink.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      clientId: true,
      expiresAt: true,
      revokedAt: true,
      accountIds: true,
      mediaLibraryIds: true,
      dataLibraryIds: true,
      includePublications: true,
      firstOpenedAt: true,
      client: { select: { name: true } },
    },
  });
  if (!row) return { valid: false, reason: "not_found" };

  const status = exportLinkStatus(row);
  if (status !== "active") return { valid: false, reason: status };

  return {
    valid: true,
    link: {
      id: row.id,
      clientId: row.clientId,
      clientName: row.client.name,
      expiresAt: row.expiresAt,
      firstOpenedAt: row.firstOpenedAt,
      selection: {
        clientId: row.clientId,
        accountIds: row.accountIds,
        mediaLibraryIds: row.mediaLibraryIds,
        dataLibraryIds: row.dataLibraryIds,
        includePublications: row.includePublications,
      },
    },
  };
}

// ─── Activité côté client ─────────────────────────────────────────────────────

/** Le manifeste a été chargé par la page (jamais posé par le GET HTML). */
export async function recordExportOpened(link: { id: string; firstOpenedAt: Date | null }): Promise<void> {
  const now = new Date();
  await prisma.clientExportLink
    .update({
      where: { id: link.id },
      data: { lastOpenedAt: now, ...(link.firstOpenedAt ? {} : { firstOpenedAt: now }) },
    })
    .catch((err) => console.warn(`[clientExport] activité non enregistrée (link=${link.id}) :`, err));
}

export async function recordExportEvent(linkId: string, event: ExportEventRequest): Promise<void> {
  const report: ExportReport = {
    files: event.files,
    bytes: event.bytes,
    skipped: event.skipped,
    failed: event.failed,
    missing: event.missing,
  };
  const now = new Date();
  let data: Prisma.ClientExportLinkUpdateInput;
  if (event.type === "started") {
    const current = await prisma.clientExportLink.findUnique({
      where: { id: linkId },
      select: { downloadStartedAt: true },
    });
    data = {
      startCount: { increment: 1 },
      ...(current?.downloadStartedAt ? {} : { downloadStartedAt: now }),
    };
  } else {
    // « Terminé » seulement sans échec : un client qui a tout récupéré.
    const complete = event.type === "completed" && event.failed === 0;
    data = {
      lastReport: report as unknown as Prisma.InputJsonValue,
      ...(complete ? { downloadCompletedAt: now } : {}),
    };
  }
  await prisma.clientExportLink.update({ where: { id: linkId }, data });
}
