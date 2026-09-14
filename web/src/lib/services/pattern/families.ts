/**
 * Familles éditoriales existantes — alimente les Combobox `allowCustom` de
 * saisie de `PatternTemplate.family`.
 *
 * La famille est du texte libre (doctrine `setTag` / `MediaAsset.setTag` : pas
 * de table, pas d'enum). Proposer les valeurs déjà saisies est donc le SEUL
 * garde-fou contre « TRANSAC » à côté de « TRANSACTION » — deux familles pour
 * un même groupe rendraient le filtre de « Remplir la semaine » faux sans rien
 * signaler.
 *
 * Les recettes archivées sont exclues : leur famille ne doit pas ressusciter
 * une valeur abandonnée dans les suggestions.
 */
import { prisma as defaultPrisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { compareNatural } from "@/lib/utils/naturalSort";

export async function listPatternFamilies(
  prisma: PrismaClient = defaultPrisma,
): Promise<string[]> {
  const rows = await prisma.patternTemplate.findMany({
    where: { isArchived: false, family: { not: null } },
    select: { family: true },
    distinct: ["family"],
  });
  return rows
    .map((r) => r.family)
    .filter((f): f is string => !!f)
    .sort(compareNatural);
}
