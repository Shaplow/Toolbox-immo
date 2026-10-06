/**
 * GET /api/export/[token]/data/[libraryId]?account=<accountId|c>
 *
 * Fichier .xlsx des fiches d'une bibliothèque de données pour un compte
 * (fiches réservées) ou pour « Commun » (`c` : fiches sans restriction).
 * Refusé (404) si ce couple ne fait pas partie du manifeste du lien.
 *
 * Écrit EN FLUX (ExcelJS WorkbookWriter, fiches lues par pages) : un import CSV
 * peut créer des dizaines de milliers de fiches, et un classeur construit en
 * mémoire coûte près d'1 Go à 50 000 lignes sur le process Node unique. Une
 * erreur en cours de route coupe le flux (pas de fin propre) : le moteur du
 * client voit un échec et réessaie, il n'enregistre jamais un fichier tronqué.
 *
 * Excel plutôt que CSV : accents et colonnes s'ouvrent correctement dans
 * Excel FR sans réglage, ce qui n'est pas le cas d'un CSV.
 */

import { PassThrough, Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COMMON_ACCOUNT_REF, dataRef } from "@/lib/clientExport/ids";
import {
  collectFieldKeys,
  dataSheetRow,
  declaredFieldColumns,
  sanitizeSheetName,
  sheetColumns,
} from "@/lib/clientExport/dataSheet";
import { findExportDataItem } from "@/lib/services/clientExport/exportManifest";
import { iterateDataEntriesForExport } from "@/lib/services/clientExport/exportScope";
import { createPublicExportGuard, NO_STORE_HEADERS } from "@/lib/services/clientExport/publicGuard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Un fichier par (bibliothèque, compte) : un client à 30 comptes en demande des
// dizaines en quelques secondes au départ ou à chaque reprise (les .xlsx sont
// toujours réécrits). Même plafond que `urls`, chaque appel restant gardé par le jeton.
const guard = createPublicExportGuard({ windowMs: 60_000, max: 600 });

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NOT_FOUND = { error: "Fichier introuvable" };

type Params = { params: Promise<{ token: string; libraryId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { token, libraryId } = await params;
  const auth = await guard(req, token);
  if (auth.response) return auth.response;

  const account = new URL(req.url).searchParams.get("account") ?? "";
  if (!account) return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE_HEADERS });
  const accountId = account === COMMON_ACCOUNT_REF ? null : account;

  let library: { name: string; fieldsSchema: string } | null;
  let fieldColumns: ReturnType<typeof declaredFieldColumns>;
  try {
    const item = await findExportDataItem(auth.link, dataRef(libraryId, accountId));
    if (!item) return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE_HEADERS });

    library = await prisma.dataLibrary.findUnique({
      where: { id: libraryId },
      select: { name: true, fieldsSchema: true },
    });
    if (!library) return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE_HEADERS });

    fieldColumns = declaredFieldColumns(library.fieldsSchema);
    if (!fieldColumns) {
      // Sans schéma, les colonnes sont l'union des clés : un premier passage
      // (en flux lui aussi) les collecte avant d'écrire la première ligne.
      const keys = new Set<string>();
      for await (const page of iterateDataEntriesForExport(libraryId, accountId)) {
        for (const entry of page) collectFieldKeys(keys, entry.fields);
      }
      fieldColumns = [...keys].map((key) => ({ key, label: key }));
    }
  } catch (err) {
    console.error(`[export/data] link=${auth.link.id} library=${libraryId} :`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500, headers: NO_STORE_HEADERS });
  }

  const columns = sheetColumns(fieldColumns);
  const ExcelJS = (await import("exceljs")).default;
  const output = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: true,
    useSharedStrings: false,
  });
  const worksheet = workbook.addWorksheet(sanitizeSheetName(library.name), {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.columns = columns.map((column) => ({ key: column.key, width: 22 }));

  const linkId = auth.link.id;
  const rowsFor = fieldColumns;
  void (async () => {
    try {
      const header = worksheet.addRow(columns.map((c) => c.label));
      header.font = { bold: true };
      header.commit();
      for await (const page of iterateDataEntriesForExport(libraryId, accountId)) {
        for (const entry of page) worksheet.addRow(dataSheetRow(rowsFor, entry)).commit();
      }
      worksheet.commit();
      await workbook.commit();
    } catch (err) {
      console.error(`[export/data] écriture interrompue link=${linkId} library=${libraryId} :`, err);
      // Coupe le flux SANS fin propre : le client voit une erreur réseau, pas un fichier tronqué.
      output.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return new NextResponse(Readable.toWeb(output) as ReadableStream<Uint8Array>, {
    headers: { ...NO_STORE_HEADERS, "Content-Type": XLSX_MIME },
  });
}
