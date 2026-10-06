/**
 * GET /api/export/[token]/data/[libraryId]?account=<accountId|c>
 *
 * Fichier .xlsx des fiches d'une bibliothèque de données pour un compte
 * (fiches réservées) ou pour « Commun » (`c` : fiches sans restriction).
 * Généré à la demande — quelques centaines de lignes de texte, sans risque
 * mémoire. Refusé (404) si ce couple ne fait pas partie du manifeste du lien.
 *
 * Excel plutôt que CSV : accents et colonnes s'ouvrent correctement dans
 * Excel FR sans réglage, ce qui n'est pas le cas d'un CSV.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COMMON_ACCOUNT_REF, dataRef } from "@/lib/clientExport/ids";
import { buildDataSheet, sanitizeSheetName } from "@/lib/clientExport/dataSheet";
import { findExportDataItem } from "@/lib/services/clientExport/exportManifest";
import { loadDataEntriesForExport } from "@/lib/services/clientExport/exportScope";
import { createPublicExportGuard, NO_STORE_HEADERS } from "@/lib/services/clientExport/publicGuard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const guard = createPublicExportGuard({ windowMs: 60_000, max: 60 });

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

  try {
    const item = await findExportDataItem(auth.link, dataRef(libraryId, accountId));
    if (!item) return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE_HEADERS });

    const [library, entries] = await Promise.all([
      prisma.dataLibrary.findUnique({ where: { id: libraryId }, select: { name: true, fieldsSchema: true } }),
      loadDataEntriesForExport(libraryId, accountId),
    ]);
    if (!library) return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE_HEADERS });

    const sheet = buildDataSheet({ fieldsSchema: library.fieldsSchema, entries });

    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sanitizeSheetName(library.name));
    worksheet.addRow(sheet.columns.map((c) => c.label));
    worksheet.getRow(1).font = { bold: true };
    for (const row of sheet.rows) worksheet.addRow(row);
    worksheet.columns.forEach((column) => {
      column.width = 22;
    });
    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: { ...NO_STORE_HEADERS, "Content-Type": XLSX_MIME },
    });
  } catch (err) {
    console.error(`[export/data] link=${auth.link.id} library=${libraryId} :`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
