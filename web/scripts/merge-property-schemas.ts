#!/usr/bin/env tsx
/**
 * Plan simplification Phase 5 — fusionne l'union des `Property.fieldSchema`
 * (schémas par instance, modèle historique) dans `EntityType.fieldSchema` du
 * type « Bien » (etype_bien).
 *
 * À exécuter AVANT le drop de la table Property (pending-drops/phase5-drops.sql)
 * — sinon les clés de champs définies uniquement sur certaines fiches perdent
 * leur libellé/type (les VALEURS restent lisibles : Entity.fields est un
 * Record affiché même sans schéma).
 *
 * Idempotent : une clé déjà présente dans le schéma du type est conservée
 * telle quelle (le type est prioritaire).
 *
 * Usage :
 *   cd web && dotenv -e .env.local -- tsx scripts/merge-property-schemas.ts
 *   # dry-run : ajouter --dry
 */

import { PrismaClient } from "@prisma/client";
import { normalizeCustomFields, serializeCustomFields, type CustomField } from "../src/lib/customFields";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

async function main() {
  const type = await prisma.entityType.findUnique({ where: { id: "etype_bien" } });
  if (!type) {
    console.error("Type etype_bien introuvable — la migration Phase 5 est-elle appliquée ?");
    process.exit(1);
  }

  const properties = await prisma.property.findMany({ select: { id: true, fieldSchema: true } });
  const merged: CustomField[] = normalizeCustomFields(type.fieldSchema);
  const known = new Set(merged.map((f) => f.key));
  let added = 0;

  for (const p of properties) {
    for (const f of normalizeCustomFields(p.fieldSchema)) {
      if (known.has(f.key)) continue;
      merged.push(f);
      known.add(f.key);
      added += 1;
    }
  }

  console.log(`Propriétés scannées : ${properties.length} — champs ajoutés au type Bien : ${added}`);
  if (added === 0) {
    console.log("Rien à fusionner.");
    return;
  }
  if (DRY) {
    console.log("[dry-run] Schéma résultant :", JSON.stringify(merged, null, 2));
    return;
  }
  await prisma.entityType.update({
    where: { id: "etype_bien" },
    data: { fieldSchema: serializeCustomFields(merged) },
  });
  console.log("EntityType etype_bien mis à jour.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
