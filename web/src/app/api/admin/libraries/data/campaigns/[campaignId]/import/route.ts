import { NextRequest, NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ campaignId: string }> };

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
 * POST /api/admin/libraries/data/campaigns/[campaignId]/import
 *
 * Body: multipart/form-data avec un champ "file" (CSV, UTF-8)
 *
 * Format CSV attendu :
 *   - Première ligne = noms des colonnes (clés du champ `fields`)
 *   - Colonnes réservées (exclues de `fields`) : `set_tag`, `category`
 *   - Si `set_tag` absent, un slug est auto-généré depuis la première colonne de données
 *   - Lignes suivantes = valeurs
 *
 * Exemple RPI avec set :
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

  const { campaignId } = await params;
  let campaign;
  try {
    campaign = await prisma.dataCampaign.findUnique({ where: { id: campaignId } });
  } catch (err) {
    console.error(`[admin/libraries/data/campaigns/${campaignId}/import] findUnique error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json({ error: "Campaign introuvable" }, { status: 404 });
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
  // si la campaign a déjà des entrées, exiger force=true dans le formData.
  const existingCount = await prisma.dataEntry.count({ where: { campaignId } });
  if (existingCount > 0 && formData.get("force") !== "true") {
    return NextResponse.json(
      {
        error: `Cette campaign contient déjà ${existingCount} entrée(s). Envoyez force=true pour ajouter quand même.`,
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
  const rows = parseCSV(text);

  if (rows.length < 2) {
    return NextResponse.json({ error: "Le fichier CSV doit contenir au moins une ligne d'en-tête et une ligne de données" }, { status: 400 });
  }

  const [headers, ...dataRows] = rows;
  const sanitizedHeaders = headers.map((h) => sanitizeKey(h));

  // Vérifier qu'il n'y a pas de doublons de colonnes
  const uniqueHeaders = new Set(sanitizedHeaders);
  if (uniqueHeaders.size !== sanitizedHeaders.length) {
    return NextResponse.json({ error: "Le CSV contient des colonnes en double" }, { status: 400 });
  }

  // Colonnes réservées — extraites de fields et mappées sur les champs Prisma dédiés.
  // Si set_tag absent mais qu'une autre colonne est désignée comme clé (première colonne non réservée),
  // un slug est généré automatiquement.
  const RESERVED = new Set(["set_tag", "category"]);
  const setTagIdx = sanitizedHeaders.indexOf("set_tag");
  const categoryIdx = sanitizedHeaders.indexOf("category");
  // Index de la première colonne "données" (pour le slug auto si pas de set_tag)
  const firstDataIdx = sanitizedHeaders.findIndex((h) => !RESERVED.has(h));

  const entries = dataRows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const fields: Record<string, string> = {};
      for (let i = 0; i < sanitizedHeaders.length; i++) {
        if (RESERVED.has(sanitizedHeaders[i])) continue;
        fields[sanitizedHeaders[i]] = sanitizeValue(row[i] ?? "");
      }

      // setTag : colonne set_tag si présente, sinon slug de la première colonne de données
      let setTag: string | null = null;
      if (setTagIdx !== -1 && (row[setTagIdx] ?? "").trim()) {
        setTag = sanitizeValue(row[setTagIdx] ?? "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 64) || null;
      } else if (firstDataIdx !== -1 && (row[firstDataIdx] ?? "").trim()) {
        setTag = slugify(row[firstDataIdx] ?? "");
      }

      // category : colonne category si présente
      const category = categoryIdx !== -1 && (row[categoryIdx] ?? "").trim()
        ? sanitizeValue(row[categoryIdx] ?? "")
        : null;

      return { campaignId, fields: JSON.stringify(fields), setTag, category };
    });

  if (entries.length === 0) {
    return NextResponse.json({ error: "Aucune ligne de données trouvée dans le CSV" }, { status: 400 });
  }

  try {
    const result = await prisma.dataEntry.createMany({ data: entries });
    return NextResponse.json({ imported: result.count }, { status: 201 });
  } catch (err) {
    console.error(`[admin/libraries/data/campaigns/${campaignId}/import] createMany error:`, err);
    return NextResponse.json({ error: "Erreur serveur lors de l'import" }, { status: 500 });
  }
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
