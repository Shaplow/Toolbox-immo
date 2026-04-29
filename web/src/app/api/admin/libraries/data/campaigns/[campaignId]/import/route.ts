import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function adminOnly(role?: string) {
  return role !== "ADMIN";
}

type Params = { params: Promise<{ campaignId: string }> };

const MAX_CSV_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * POST /api/admin/libraries/data/campaigns/[campaignId]/import
 *
 * Body: multipart/form-data avec un champ "file" (CSV, UTF-8)
 *
 * Format CSV attendu :
 *   - Première ligne = noms des colonnes (clés du champ `fields`)
 *   - Lignes suivantes = valeurs
 *
 * Exemple RPI :
 *   quartier,arrondissement,prix_m2,evo_5ans_pct
 *   Marais,75004,15200,+12.5
 *   Nation,75011,11800,+8.3
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id || adminOnly(session.user.role)) {
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

  const text = await file.text();
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

  const entries = dataRows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const fields: Record<string, string> = {};
      for (let i = 0; i < sanitizedHeaders.length; i++) {
        fields[sanitizedHeaders[i]] = sanitizeValue(row[i] ?? "");
      }
      return { campaignId, fields: JSON.stringify(fields) };
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
