import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

const MAX_CSV_SIZE = 5 * 1024 * 1024; // 5 MB

/** Phase 1.x Vague 2 — parsing xlsx côté serveur via ExcelJS.
 *  Le client envoie le fichier tel quel (csv ou xlsx) ; le serveur détecte
 *  l'extension et convertit le xlsx en CSV avant le pipeline existant.
 *  Import dynamique pour ne pas charger exceljs au cold-start des autres routes. */
async function readFileAsCSVText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const ExcelJS = (await import("exceljs")).default;
    const buffer = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error("Aucune feuille trouvée dans le fichier Excel.");
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      // ExcelJS index les cellules à partir de 1 et "skip" les vides ;
      // on force la longueur pour matcher la colonne max de la ligne.
      const maxCol = row.cellCount;
      for (let c = 1; c <= maxCol; c++) {
        const cell = row.getCell(c);
        const v = cell.value;
        let s = "";
        if (v == null) s = "";
        else if (typeof v === "object" && "text" in v) s = String((v as { text: string }).text ?? "");
        else if (typeof v === "object" && "result" in v) s = String((v as { result: unknown }).result ?? "");
        else if (v instanceof Date) s = v.toISOString();
        else s = String(v);
        cells.push(s);
      }
      rows.push(cells);
    });
    // CSV : on quote uniquement quand nécessaire (virgule, quote, newline).
    return rows
      .map((r) =>
        r
          .map((c) => {
            if (/[",\n\r]/.test(c)) return `"${c.replace(/"/g, '""')}"`;
            return c;
          })
          .join(","),
      )
      .join("\n");
  }
  return file.text();
}

/**
 * POST /api/admin/libraries/data/[id]/entries/import
 *
 * Body: multipart/form-data avec un champ "file" (CSV, UTF-8)
 *
 * Format CSV attendu :
 *   - Première ligne = noms des colonnes (clés du champ `fields`)
 *   - Colonnes réservées (exclues de `fields`) : `set_tag`, `category`
 *     (`category` reste réservée/ignorée — colonne dépréciée, plus stockée)
 *   - Si `set_tag` absent, un slug est auto-généré depuis la première colonne de données
 *   - Lignes suivantes = valeurs
 *
 * Exemple RPI avec dossier :
 *   set_tag,category,quartier,prix_m2,evo_5ans_pct
 *   marais,Paris intra-muros,Marais,15200,+12.5
 *   nation,Paris intra-muros,Nation,11800,+8.3
 *
 * Exemple sans set_tag (slug auto depuis 'quartier') :
 *   quartier,prix_m2,evo_5ans_pct
 *   Marais,15200,+12.5
 */
export async function POST(req: NextRequest, { params }: Params) {
  const userContext = await getUserContext();
  if (!userContext?.effectiveUser.id || !userContext.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const { id: libraryId } = await params;
  let library;
  try {
    library = await prisma.dataLibrary.findUnique({ where: { id: libraryId }, select: { id: true } });
  } catch (err) {
    console.error(`[admin/libraries/data/${libraryId}/entries/import] findUnique error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!library) {
    return NextResponse.json({ error: "Bibliothèque introuvable" }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Fichier CSV requis (champ 'file')" }, { status: 400 });
  }

  if (file.size > MAX_CSV_SIZE) {
    return NextResponse.json({ error: "Fichier trop volumineux (max 5 MB)" }, { status: 400 });
  }

  const fileName = (file as File).name.toLowerCase();
  const isCSV = fileName.endsWith(".csv") || fileName.endsWith(".txt");
  const isXLSX = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");
  if (!isCSV && !isXLSX) {
    return NextResponse.json({ error: "Format non supporté. Utilise .csv ou .xlsx" }, { status: 400 });
  }

  // Garde contre la ré-importation accidentelle :
  // si la bibliothèque a déjà des entrées, exiger force=true dans le formData.
  // L'atomicité (count + createMany dans la même tx) est dans le createMany bloc
  // plus bas pour éviter de tenir une tx pendant tout le parsing CSV.
  const existingCount = await prisma.dataEntry.count({ where: { libraryId } });
  const forceFlag = formData.get("force") === "true";
  // En dry-run on ne bloque pas : le preview affiche existingCount et le client
  // confirmera avec force=true au commit.
  const isDryGuard = req.nextUrl.searchParams.get("dry") === "true";
  if (existingCount > 0 && !forceFlag && !isDryGuard) {
    return NextResponse.json(
      {
        error: `Cette bibliothèque contient déjà ${existingCount} entrée(s). Envoyez force=true pour ajouter quand même.`,
        existingCount,
      },
      { status: 409 }
    );
  }

  let text: string;
  try {
    text = await readFileAsCSVText(file as File);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur lecture fichier" }, { status: 400 });
  }

  // Parsing factorisé (dry-run ET commit utilisent le même plan pour éviter
  // toute divergence preview/réalité).
  let plan: ImportPlan;
  try {
    plan = buildImportPlan(text, libraryId);
  } catch (err) {
    if (err instanceof ImportValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  const { entries, columns, hasSetTag, hasCategory, skippedEmpty } = plan;

  if (entries.length === 0) {
    return NextResponse.json({ error: "Aucune ligne de données trouvée dans le CSV" }, { status: 400 });
  }

  // Mode dry-run (preview) : on retourne le plan SANS insérer. La garde
  // existingCount/force n'est pas appliquée ici — le client l'affiche et
  // confirmera avec force=true au commit si besoin.
  const isDry = req.nextUrl.searchParams.get("dry") === "true";
  if (isDry) {
    const sample = entries.slice(0, 8).map((e) => ({
      setTag: e.setTag,
      fields: JSON.parse(e.fields) as Record<string, string>,
    }));
    return NextResponse.json({
      dryRun: true,
      detected: entries.length,
      columns,
      reserved: { set_tag: hasSetTag, category: hasCategory },
      skippedEmpty,
      existingCount,
      sample,
    });
  }

  // Bug-hunter #10 (2026-06-01) : transaction + advisory lock pour éviter
  // double-import sous double-click ou requêtes concurrentes. Le lock sur le
  // hash de libraryId est libéré au commit/rollback. Re-vérifier le count
  // à l'intérieur du lock pour fail si une autre tx a importé entre-temps.
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Advisory lock — sérialise les imports concurrents sur la même bibliothèque.
      // pg_advisory_xact_lock prend un bigint, on hash le libraryId via hashtext.
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `import:${libraryId}`,
      );

      // Re-vérification atomique : si une autre tx a importé pendant qu'on
      // attendait le lock, on respecte la garde force=true.
      const reCheck = await tx.dataEntry.count({ where: { libraryId } });
      if (reCheck > existingCount && !forceFlag) {
        throw new Error(
          `Une autre import a ajouté ${reCheck - existingCount} entrée(s) pendant la requête. Recharge et confirme avec force=true.`,
        );
      }

      return tx.dataEntry.createMany({ data: entries });
    });
    return NextResponse.json({ imported: result.count }, { status: 201 });
  } catch (err) {
    console.error(`[admin/libraries/data/${libraryId}/entries/import] createMany error:`, err);
    const msg = err instanceof Error && err.message.startsWith("Une autre import")
      ? err.message
      : "Erreur serveur lors de l'import";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}

// ─── Plan d'import (partagé dry-run / commit) ──────────────────────────────────

interface ImportEntry {
  libraryId: string;
  fields: string;
  setTag: string | null;
}

interface ImportPlan {
  entries: ImportEntry[];
  /** Colonnes non réservées (= clés de `fields`). */
  columns: string[];
  hasSetTag: boolean;
  hasCategory: boolean;
  /** Lignes ignorées car entièrement vides. */
  skippedEmpty: number;
}

/** Erreur de validation fatale du fichier (format → 400 dans les deux modes). */
class ImportValidationError extends Error {}

/**
 * Construit le plan d'import depuis le texte CSV. Utilisé par le dry-run
 * (preview) ET le commit pour garantir que ce qui est prévisualisé est
 * exactement ce qui sera inséré.
 */
function buildImportPlan(text: string, libraryId: string): ImportPlan {
  const rows = parseCSV(text);
  if (rows.length < 2) {
    throw new ImportValidationError(
      "Le fichier doit contenir au moins une ligne d'en-tête et une ligne de données",
    );
  }

  const [headers, ...dataRows] = rows;
  const sanitizedHeaders = headers.map((h) => sanitizeKey(h));

  const uniqueHeaders = new Set(sanitizedHeaders);
  if (uniqueHeaders.size !== sanitizedHeaders.length) {
    throw new ImportValidationError("Le fichier contient des colonnes en double");
  }

  const RESERVED = new Set(["set_tag", "category"]);
  const setTagIdx = sanitizedHeaders.indexOf("set_tag");
  const categoryIdx = sanitizedHeaders.indexOf("category");
  const firstDataIdx = sanitizedHeaders.findIndex((h) => !RESERVED.has(h));
  const columns = sanitizedHeaders.filter((h) => !RESERVED.has(h));

  const nonEmptyRows = dataRows.filter((row) =>
    row.some((cell) => cell.trim() !== ""),
  );
  const skippedEmpty = dataRows.length - nonEmptyRows.length;

  const entries: ImportEntry[] = nonEmptyRows.map((row) => {
    const fields: Record<string, string> = {};
    for (let i = 0; i < sanitizedHeaders.length; i++) {
      if (RESERVED.has(sanitizedHeaders[i])) continue;
      const value = sanitizeValue(row[i] ?? "");
      if (value === "") continue;
      fields[sanitizedHeaders[i]] = value;
    }

    let setTag: string | null = null;
    if (setTagIdx !== -1 && (row[setTagIdx] ?? "").trim()) {
      setTag =
        sanitizeValue(row[setTagIdx] ?? "")
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^a-z0-9_]/g, "")
          .slice(0, 64) || null;
    } else if (firstDataIdx !== -1 && (row[firstDataIdx] ?? "").trim()) {
      setTag = slugify(row[firstDataIdx] ?? "");
    }

    return { libraryId, fields: JSON.stringify(fields), setTag };
  });

  return {
    entries,
    columns,
    hasSetTag: setTagIdx !== -1,
    hasCategory: categoryIdx !== -1,
    skippedEmpty,
  };
}

// ─── Helpers CSV ─────────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return lines
    .filter((l) => l.trim() !== "")
    .map((line) => {
      const row: string[] = [];
      let current = "";
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const next = line[i + 1];

        if (inQuotes) {
          if (ch === '"' && next === '"') {
            current += '"';
            i++;
          } else if (ch === '"') {
            inQuotes = false;
          } else {
            current += ch;
          }
        } else {
          if (ch === '"') {
            inQuotes = true;
          } else if (ch === "," || ch === ";") {
            row.push(current.trim());
            current = "";
          } else {
            current += ch;
          }
        }
      }
      row.push(current.trim());
      return row;
    });
}

function sanitizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 64);
}

function sanitizeValue(value: string): string {
  return value.trim().slice(0, 2000);
}

function slugify(value: string): string | null {
  return (
    value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 64) || null
  );
}
