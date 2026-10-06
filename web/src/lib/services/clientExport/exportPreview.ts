/**
 * Aperçu des volumes pour le tiroir admin « Nouveau lien de téléchargement ».
 *
 * Résout le périmètre le plus large possible (tous les comptes du client, toutes
 * les bibliothèques, publications comprises) avec EXACTEMENT les mêmes règles
 * que le lien (exportScope.ts), puis agrège par bibliothèque et par compte :
 * le tiroir somme ensuite côté navigateur selon les cases, sans refaire d'appel.
 *
 * Le premier appel pour un client peut prendre quelques secondes : les tailles
 * inconnues des médias historiques sont retrouvées puis enregistrées.
 */

import { prisma } from "@/lib/prisma";
import { SHARED_SENTINEL_IDS } from "@/lib/rotation/sentinels";
import type { ExportItem, ExportPreview, ExportVolume } from "@/lib/clientExport/types";
import { resolveExportScope } from "./exportScope";
import { ensureExportSizes } from "./exportSizes";

function add(volume: ExportVolume | undefined, files: number, bytes: number): ExportVolume {
  return { files: (volume?.files ?? 0) + files, bytes: (volume?.bytes ?? 0) + bytes };
}

export async function buildExportPreview(clientId: string): Promise<ExportPreview> {
  const [accounts, mediaLibraries, dataLibraries] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: { clientId, id: { notIn: [...SHARED_SENTINEL_IDS] } },
      select: { id: true },
    }),
    prisma.mediaLibrary.findMany({ where: { type: { in: ["video", "audio"] } }, select: { id: true } }),
    prisma.dataLibrary.findMany({ select: { id: true } }),
  ]);

  const scope = await resolveExportScope({
    clientId,
    accountIds: accounts.map((a) => a.id),
    mediaLibraryIds: mediaLibraries.map((l) => l.id),
    dataLibraryIds: dataLibraries.map((l) => l.id),
    includePublications: true,
  });

  const sized = await ensureExportSizes(scope.items, () => "");

  const libraries = new Map(
    scope.libraries.map((l) => [
      l.id,
      {
        id: l.id,
        name: l.name,
        type: l.type,
        perAccount: {} as Record<string, ExportVolume>,
        common: l.type === "video" ? null : ({ files: 0, bytes: 0 } as ExportVolume | null),
      },
    ]),
  );
  const publicationsPerAccount: Record<string, ExportVolume> = {};
  const unavailable: Record<string, number> = {};

  const countItem = (item: ExportItem) => {
    if (item.kind === "publication") {
      publicationsPerAccount[item.accountId] = add(publicationsPerAccount[item.accountId], 1, item.sizeBytes ?? 0);
      return;
    }
    const library = libraries.get(item.libraryId);
    if (!library) return;
    const files = item.kind === "data" ? item.entryCount : 1;
    const bytes = item.kind === "media" ? (item.sizeBytes ?? 0) : 0;
    if (item.accountId === null) {
      library.common = add(library.common ?? undefined, files, bytes);
    } else {
      library.perAccount[item.accountId] = add(library.perAccount[item.accountId], files, bytes);
    }
  };
  sized.items.forEach(countItem);

  for (const skip of [...scope.skipped, ...sized.skipped]) {
    if (skip.kind === "publication" && skip.accountId) {
      unavailable[skip.accountId] = (unavailable[skip.accountId] ?? 0) + 1;
    }
  }

  // scope.libraries contient toutes les bibliothèques de la base : le tiroir ne
  // montre que celles qui ont quelque chose à exporter pour ce client.
  const hasContent = (l: { perAccount: Record<string, ExportVolume>; common: ExportVolume | null }) =>
    Object.keys(l.perAccount).length > 0 || (l.common?.files ?? 0) > 0;

  const typeOrder = { video: 0, audio: 1, data: 2 } as const;
  return {
    accounts: scope.accounts,
    libraries: [...libraries.values()]
      .filter(hasContent)
      .sort((a, b) => typeOrder[a.type] - typeOrder[b.type] || a.name.localeCompare(b.name, "fr")),
    publications: { perAccount: publicationsPerAccount, unavailable },
    missingFiles: sized.skipped.filter((s) => s.reason === "missing").length,
  };
}
