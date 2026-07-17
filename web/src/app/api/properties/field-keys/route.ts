/**
 * GET /api/properties/field-keys — clés de champs personnalisés distinctes,
 * agrégées sur tous les biens non archivés.
 *
 * Alimente le sélecteur « Champ du bien qui pré-remplit la légende » du form
 * recette (mode description "preFilled"). L'admin choisit une clé existante ;
 * la saisie libre reste possible côté UI pour un bien pas encore créé.
 *
 * Admin-only. Auth via getUserContext() / canAdminBypass.
 */
import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/userContext";
import { prisma } from "@/lib/prisma";
import { normalizeCustomFields } from "@/lib/customFields";

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const properties = await prisma.property.findMany({
    where: { isArchived: false },
    select: { fieldSchema: true },
  });

  // Dédup par clé — première occurrence gagne pour le label (les biens partagent
  // généralement le même schéma, donc peu de divergence).
  const byKey = new Map<string, { key: string; label: string }>();
  for (const p of properties) {
    for (const f of normalizeCustomFields(p.fieldSchema)) {
      if (!byKey.has(f.key)) byKey.set(f.key, { key: f.key, label: f.label || f.key });
    }
  }

  const keys = [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, "fr"));
  return NextResponse.json(keys);
}
