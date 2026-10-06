/**
 * Périmètre d'un lien d'export : quels fichiers appartiennent à quel compte.
 *
 * SOURCE UNIQUE pour l'aperçu admin, le manifeste public ET l'autorisation des
 * URLs signées : une ref n'est signée que si elle sort d'ici (anti-IDOR).
 *
 * Règles (décisions du user, plan du 06/10/2026) :
 * - les bibliothèques n'appartiennent à personne : l'appartenance se lit média
 *   par média (MediaAssetAccess / DataEntryAccess, 0 ligne = commun) ;
 * - vidéos ET sons réservés à un compte du client → sous ce compte (un média
 *   réservé à deux comptes du client est copié dans les deux dossiers) ;
 * - sons et fiches COMMUNS → une seule fois dans « Commun » ; vidéos communes :
 *   jamais (stock partagé, auto-save d'autres clients) ;
 * - ce qui est réservé à des comptes hors sélection n'apparaît jamais ;
 * - vidéos auto-sauvées (source "generated") exclues — elles sortent par
 *   « Vidéos publiées » si elles ont été publiées ;
 * - publications : slots PUBLISHED (ou ARCHIVED avec une trace de
 *   publication) du compte principal, vidéo finale résolue par finalVideo.ts.
 *
 * Les comptes sont re-vérifiés à chaque appel : un compte déplacé vers un autre
 * client après la création du lien sort du périmètre.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SHARED_SENTINEL_IDS, isReservedSetTag } from "@/lib/rotation/sentinels";
import { isLocalStorage } from "@/lib/storage";
import { numericDateFr } from "@/lib/date/formatFr";
import { dataRef, mediaRef, publicationRef } from "@/lib/clientExport/ids";
import { resolveSlotFinalVideo } from "@/lib/clientExport/finalVideo";
import type {
  DataExportItem,
  ExportFileKind,
  ExportItem,
  ExportSelection,
  ExportSkipped,
  MediaExportItem,
  PublicationExportItem,
  TreeAccount,
  TreeLibrary,
} from "@/lib/clientExport/types";

/**
 * `source` vaut NULL pour tous les uploads historiques : `{ not: "generated" }`
 * seul exclurait aussi les NULL (SQL `<>`) et viderait l'export vidéo.
 * Toujours placé dans un `AND: [...]`, jamais par spread (collision de clés OR).
 */
export const NOT_GENERATED: Prisma.MediaAssetWhereInput = {
  OR: [{ source: null }, { source: { not: "generated" } }],
};

/** Un élément écarté, avec de quoi le compter par compte dans l'aperçu admin. */
export interface ScopeSkipped extends ExportSkipped {
  kind: ExportFileKind;
  accountId: string | null;
}

export interface ResolvedExportScope {
  accounts: TreeAccount[];
  libraries: TreeLibrary[];
  items: ExportItem[];
  skipped: ScopeSkipped[];
}

const MEDIA_SELECT = {
  id: true,
  libraryId: true,
  filename: true,
  r2Key: true,
  url: true,
  setTag: true,
  sizeBytes: true,
  createdAt: true,
  // media_edit réécrit le fichier en MP4 sous l'ancien nom : l'arbre corrige l'extension.
  editJobs: { where: { status: "done" }, select: { id: true }, take: 1 },
} satisfies Prisma.MediaAssetSelect;

type MediaRow = Prisma.MediaAssetGetPayload<{ select: typeof MEDIA_SELECT }>;

function toMediaItem(
  row: MediaRow,
  libraryType: "video" | "audio",
  accountId: string | null,
): MediaExportItem {
  return {
    kind: "media",
    ref: mediaRef(row.id, accountId),
    accountId,
    assetId: row.id,
    libraryId: row.libraryId,
    libraryType,
    folder: isReservedSetTag(row.setTag) ? null : (row.setTag?.trim() || null),
    filename: row.filename,
    r2Key: row.r2Key,
    url: row.url,
    edited: row.editJobs.length > 0,
    sizeBytes: row.sizeBytes == null ? null : Number(row.sizeBytes),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Libellé lisible d'une publication : ce que le client reconnaît d'abord. */
function publicationLabel(slot: {
  title: string | null;
  patternBinding: { customLabel: string | null; patternTemplate: { label: string; clientLabel: string | null } } | null;
  patternTemplate: { label: string; clientLabel: string | null } | null;
}): string {
  const template = slot.patternBinding?.patternTemplate ?? slot.patternTemplate;
  const candidates = [
    template?.clientLabel,
    slot.title,
    slot.patternBinding?.customLabel,
    template?.label,
  ];
  return candidates.map((c) => c?.trim()).find((c): c is string => !!c) ?? "Publication";
}

export async function resolveExportScope(selection: ExportSelection): Promise<ResolvedExportScope> {
  const accounts = await prisma.instagramAccount.findMany({
    where: {
      id: { in: selection.accountIds, notIn: [...SHARED_SENTINEL_IDS] },
      clientId: selection.clientId,
    },
    select: { id: true, name: true, handle: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const empty: ResolvedExportScope = { accounts: [], libraries: [], items: [], skipped: [] };
  if (accounts.length === 0) return empty;

  const accountIds = accounts.map((a) => a.id);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const [mediaLibraries, dataLibraries] = await Promise.all([
    selection.mediaLibraryIds.length > 0
      ? prisma.mediaLibrary.findMany({
          where: { id: { in: selection.mediaLibraryIds }, type: { in: ["video", "audio"] } },
          select: { id: true, name: true, type: true },
        })
      : Promise.resolve([]),
    selection.dataLibraryIds.length > 0
      ? prisma.dataLibrary.findMany({
          where: { id: { in: selection.dataLibraryIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const libraryType = new Map<string, "video" | "audio">(
    mediaLibraries.map((l) => [l.id, l.type === "audio" ? "audio" : "video"]),
  );
  const audioLibraryIds = mediaLibraries.filter((l) => l.type === "audio").map((l) => l.id);

  const items: ExportItem[] = [];
  const skipped: ScopeSkipped[] = [];

  // ── Médias réservés aux comptes sélectionnés (vidéo et son) ────────────────
  if (mediaLibraries.length > 0) {
    const reserved = await prisma.mediaAsset.findMany({
      where: {
        AND: [
          { libraryId: { in: mediaLibraries.map((l) => l.id) } },
          { accesses: { some: { accountId: { in: accountIds } } } },
          NOT_GENERATED,
        ],
      },
      select: {
        ...MEDIA_SELECT,
        accesses: { where: { accountId: { in: accountIds } }, select: { accountId: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const row of reserved) {
      const type = libraryType.get(row.libraryId) ?? "video";
      for (const access of row.accesses) {
        items.push(toMediaItem(row, type, access.accountId));
      }
    }
  }

  // ── Sons communs : une seule fois, dans « Commun » ─────────────────────────
  if (audioLibraryIds.length > 0) {
    const common = await prisma.mediaAsset.findMany({
      where: {
        AND: [{ libraryId: { in: audioLibraryIds } }, { accesses: { none: {} } }, NOT_GENERATED],
      },
      select: MEDIA_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const row of common) items.push(toMediaItem(row, "audio", null));
  }

  // ── Fiches de données : réservées par compte, communes une fois ───────────
  if (dataLibraries.length > 0) {
    const entries = await prisma.dataEntry.findMany({
      where: { libraryId: { in: dataLibraries.map((l) => l.id) } },
      select: {
        libraryId: true,
        accesses: { where: { accountId: { in: accountIds } }, select: { accountId: true } },
        _count: { select: { accesses: true } },
      },
    });
    // libraryId → (accountId | "") → nombre de fiches
    const counts = new Map<string, Map<string, number>>();
    const bump = (libraryId: string, key: string) => {
      const perLib = counts.get(libraryId) ?? new Map<string, number>();
      perLib.set(key, (perLib.get(key) ?? 0) + 1);
      counts.set(libraryId, perLib);
    };
    for (const entry of entries) {
      if (entry._count.accesses === 0) bump(entry.libraryId, "");
      else for (const access of entry.accesses) bump(entry.libraryId, access.accountId);
    }
    for (const [libraryId, perKey] of counts) {
      for (const [key, entryCount] of perKey) {
        const accountId = key === "" ? null : key;
        const item: DataExportItem = {
          kind: "data",
          ref: dataRef(libraryId, accountId),
          accountId,
          libraryId,
          entryCount,
        };
        items.push(item);
      }
    }
  }

  // ── Vidéos publiées ────────────────────────────────────────────────────────
  if (selection.includePublications) {
    const slots = await prisma.publicationSlot.findMany({
      where: {
        accountId: { in: accountIds },
        // La migration DONE→PUBLISHED n'a pas posé publishedAt : ne jamais l'exiger.
        OR: [
          { status: "PUBLISHED" },
          { status: "ARCHIVED", OR: [{ publishedAt: { not: null } }, { publishedUrl: { not: null } }] },
        ],
      },
      select: {
        id: true,
        accountId: true,
        title: true,
        publishedAt: true,
        scheduledAt: true,
        createdAt: true,
        entity: { select: { label: true } },
        patternBinding: {
          select: { customLabel: true, patternTemplate: { select: { label: true, clientLabel: true } } },
        },
        patternTemplate: { select: { label: true, clientLabel: true } },
        currentVersion: {
          select: { r2Key: true, fileName: true, fileUrl: true, fileSizeBytes: true, deletedAt: true },
        },
        render: { select: { status: true, videoUrl: true, pngUrl: true } },
        // Conditions dans le where (pas de take: 1 sur la liste brute) : un job
        // récent sans sortie R2 ne doit pas masquer un job éligible plus ancien.
        captionJobs: {
          where: { status: "COMPLETED", staleSince: null, previewMode: false },
          orderBy: { createdAt: "desc" },
          select: { outputKey: true, outputUrl: true },
        },
      },
      orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
    });

    const publicUrl = process.env.R2_PUBLIC_URL ?? null;
    const localStorage = isLocalStorage();
    for (const slot of slots) {
      const accountId = slot.accountId!;
      const label = publicationLabel(slot);
      const date = slot.publishedAt ?? slot.scheduledAt ?? slot.createdAt;
      const video = resolveSlotFinalVideo(
        { captionJobs: slot.captionJobs, currentVersion: slot.currentVersion, render: slot.render },
        { publicUrl, localStorage },
      );
      if (!video.ok) {
        const account = accountById.get(accountId);
        skipped.push({
          kind: "publication",
          accountId,
          reason: video.reason,
          label: `${account?.name ?? "Compte"} — ${label} (${numericDateFr(date)})`,
        });
        continue;
      }
      const entityLabel = slot.entity?.label?.trim() || null;
      const item: PublicationExportItem = {
        kind: "publication",
        ref: publicationRef(slot.id),
        accountId,
        slotId: slot.id,
        source: video.source,
        r2Key: video.r2Key,
        localUrl: video.localUrl,
        fileName: video.fileName,
        sizeBytes: video.sizeBytes,
        date: date.toISOString(),
        label,
        entityLabel:
          entityLabel && entityLabel.toLocaleLowerCase("fr") !== label.toLocaleLowerCase("fr")
            ? entityLabel
            : null,
      };
      items.push(item);
    }
  }

  // TOUTES les bibliothèques sélectionnées, même vides : buildExportTree dédoublonne
  // leurs noms sur cet ensemble, qui doit rester le même d'une reprise à l'autre
  // (sinon une homonyme qui se vide ferait perdre son « (2) » à l'autre, et ses
  // fichiers changeraient de chemin). Seules celles qui ont des fichiers ont un dossier.
  const libraries: TreeLibrary[] = [
    ...mediaLibraries.map((l) => ({ id: l.id, name: l.name, type: libraryType.get(l.id) ?? ("video" as const) })),
    ...dataLibraries.map((l) => ({ id: l.id, name: l.name, type: "data" as const })),
  ];

  return { accounts, libraries, items, skipped };
}

/** Fiches d'un fichier de données : réservées au compte, ou communes (accountId null). */
export async function loadDataEntriesForExport(libraryId: string, accountId: string | null) {
  return prisma.dataEntry.findMany({
    where: {
      libraryId,
      accesses: accountId ? { some: { accountId } } : { none: {} },
    },
    select: { fields: true, setTag: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}
