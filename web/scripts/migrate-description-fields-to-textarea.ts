/**
 * Migration one-shot — passe les champs « texte long » (description, notes,
 * adresse, commentaire, résumé, bio) du type "text" vers "textarea", sur :
 *   - chaque Property.fieldSchema (la copie par bien),
 *   - le modèle par défaut AppSetting["property.defaultFieldSchema"].
 *
 * Réutilise inferDefaultFieldType (même heuristique que le défaut appliqué à la
 * création d'un champ). N'upgrade QUE text → textarea ; ne touche jamais
 * number / url / un textarea déjà posé. Idempotent (re-run = 0 changement).
 *
 * Un fieldSchema legacy stocké en string[] est réécrit en CustomField[] typé
 * (déjà normalisé à chaque lecture applicative de toute façon).
 *
 * Run (depuis web/) :
 *   npm run db:backup                                              # filet de sécurité
 *   npx tsx scripts/migrate-description-fields-to-textarea.ts --dry-run
 *   npx tsx scripts/migrate-description-fields-to-textarea.ts
 */

import { PrismaClient } from "@prisma/client";
import {
  normalizeCustomFields,
  serializeCustomFields,
  inferDefaultFieldType,
  type CustomField,
} from "../src/lib/customFields";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");
const DEFAULT_SCHEMA_KEY = "property.defaultFieldSchema";

/**
 * Upgrade text → textarea pour les champs dont le libellé/clé évoque du texte
 * long. Retourne les champs (mutés) + la liste des clés upgradées (vide si RAS).
 */
export function upgradeSchema(raw: unknown): { fields: CustomField[]; upgraded: string[] } {
  const fields = normalizeCustomFields(raw);
  const upgraded: string[] = [];
  for (const f of fields) {
    if (f.type === "text" && inferDefaultFieldType(`${f.key} ${f.label}`) === "textarea") {
      f.type = "textarea";
      upgraded.push(f.key);
    }
  }
  return { fields, upgraded };
}

async function main() {
  console.log(DRY_RUN ? "── DRY RUN (aucune écriture) ──\n" : "── APPLICATION ──\n");

  // 1. Biens — chaque Property a sa propre copie de fieldSchema.
  const properties = await prisma.property.findMany({
    select: { id: true, label: true, fieldSchema: true },
  });
  console.log(`Biens trouvés : ${properties.length}`);

  let propUpdated = 0;
  for (const p of properties) {
    const { fields, upgraded } = upgradeSchema(p.fieldSchema);
    if (upgraded.length === 0) continue;
    console.log(`[BIEN] "${p.label}" (${p.id}) — ${upgraded.join(", ")} → textarea`);
    if (!DRY_RUN) {
      await prisma.property.update({
        where: { id: p.id },
        data: { fieldSchema: serializeCustomFields(fields) },
      });
    }
    propUpdated++;
  }

  // 2. Modèle par défaut (préremplit les nouveaux biens).
  const setting = await prisma.appSetting.findUnique({ where: { key: DEFAULT_SCHEMA_KEY } });
  let defaultUpdated = false;
  if (setting) {
    const { fields, upgraded } = upgradeSchema(setting.value);
    if (upgraded.length > 0) {
      console.log(`[DÉFAUT] ${DEFAULT_SCHEMA_KEY} — ${upgraded.join(", ")} → textarea`);
      if (!DRY_RUN) {
        await prisma.appSetting.update({
          where: { key: DEFAULT_SCHEMA_KEY },
          data: { value: serializeCustomFields(fields) },
        });
      }
      defaultUpdated = true;
    }
  }

  const verb = DRY_RUN ? "à modifier" : "modifiés";
  console.log(
    `\n${DRY_RUN ? "[dry-run] " : ""}Terminé. Biens ${verb} : ${propUpdated} / ${properties.length}.` +
      ` Modèle par défaut : ${defaultUpdated ? "modifié" : "inchangé"}.`,
  );
}

main()
  .catch((err: unknown) => {
    console.error("ERREUR :", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
