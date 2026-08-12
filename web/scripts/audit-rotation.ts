/**
 * Audit LECTURE SEULE de l'état de la rotation de contenu.
 *
 * À lancer AVANT toute remédiation : c'est ce rapport qui dit quelles
 * bibliothèques changent de comportement une fois `rotationMode` devenu le
 * discriminant, et quelle part du contenu était injoignable.
 *
 *   cd web && npx dotenv -e .env.local -- tsx scripts/audit-rotation.ts
 *
 * N'écrit rien. Aucun argument.
 */

import { PrismaClient } from "@prisma/client";
import { resolveRotationMode } from "../src/lib/rotation/rotationMode";

const prisma = new PrismaClient();

/** Date de suppression du setTag auto (`pack_*`) à l'upload — commit 43d1ba9. */
const AUTO_PACK_REMOVED_AT = new Date("2026-06-17T00:00:00Z");

function section(title: string) {
  console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

async function main() {
  section("1. Bibliothèques dont le mode déclaré diverge du mode effectif");
  const libs = await prisma.mediaLibrary.findMany({
    select: {
      id: true, name: true, type: true, rotationMode: true, rotationScope: true,
      setSequence: true, maxUsageCount: true, updatedAt: true,
      _count: { select: { assets: true } },
    },
    orderBy: { name: "asc" },
  });

  const divergentes: typeof libs = [];
  for (const lib of libs) {
    const { mode, sequence } = resolveRotationMode(lib);
    // Une séquence non vide sur une bibliothèque qui tourne en auto = l'ordre
    // fixe historique n'est plus lu. C'est la population que le correctif libère.
    const diverge = mode === "auto" && sequence.length > 0;
    if (diverge) divergentes.push(lib);
    console.log(
      `  ${diverge ? "⚠ " : "  "}${lib.name.padEnd(34).slice(0, 34)} ` +
        `déclaré=${String(lib.rotationMode ?? "null").padEnd(9)} effectif=${mode.padEnd(9)} ` +
        `séquence=${String(sequence.length).padStart(3)} assets=${String(lib._count.assets).padStart(4)} ` +
        `scope=${lib.rotationScope}`,
    );
  }
  console.log(
    `\n  → ${divergentes.length} bibliothèque(s) conservent un ordre fixe qui n'est plus lu.` +
      (divergentes.length ? "\n    Vérifier qu'aucune ne devait rester en « Ordre fixe » (sinon la repasser via le drawer)." : ""),
  );

  section("2. Assets injoignables en mode ordre fixe (orphelins ou hors séquence)");
  let injoignablesTotal = 0;
  for (const lib of libs) {
    const { mode, sequence } = resolveRotationMode(lib);
    if (mode !== "override") continue;
    const known = new Set(sequence);
    const assets = await prisma.mediaAsset.findMany({
      where: { libraryId: lib.id, disabled: false },
      select: { setTag: true },
    });
    const orphelins = assets.filter((a) => !a.setTag).length;
    const horsSequence = assets.filter((a) => a.setTag && !known.has(a.setTag)).length;
    if (orphelins + horsSequence === 0) continue;
    injoignablesTotal += orphelins + horsSequence;
    console.log(
      `  ${lib.name.padEnd(34).slice(0, 34)} orphelins=${String(orphelins).padStart(4)} ` +
        `hors-séquence=${String(horsSequence).padStart(4)} / ${assets.length} assets`,
    );
  }
  console.log(`\n  → ${injoignablesTotal} asset(s) ne peuvent jamais sortir en mode ordre fixe.`);

  section("3. Générations invisibles pour la rotation par compte (Render sans accountId)");
  const renders = await prisma.render.findMany({
    where: { usedAssets: { contains: "setSequencedLibraryIds" } },
    select: { id: true, accountId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  const parSemaine = new Map<string, { sans: number; total: number }>();
  for (const r of renders) {
    const lundi = new Date(r.createdAt);
    lundi.setUTCDate(lundi.getUTCDate() - ((lundi.getUTCDay() + 6) % 7));
    const key = lundi.toISOString().slice(0, 10);
    const cur = parSemaine.get(key) ?? { sans: 0, total: 0 };
    cur.total += 1;
    if (!r.accountId) cur.sans += 1;
    parSemaine.set(key, cur);
  }
  const semaines = [...parSemaine.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 16);
  for (const [semaine, { sans, total }] of semaines) {
    const pct = total ? Math.round((sans / total) * 100) : 0;
    console.log(`  semaine du ${semaine}  sans compte ${String(sans).padStart(4)} / ${String(total).padStart(4)}  (${pct} %)`);
  }
  const sansTotal = renders.filter((r) => !r.accountId).length;
  console.log(
    `\n  → ${sansTotal} / ${renders.length} génération(s) analysées n'ont écrit aucun MediaAssetUsage.` +
      "\n    Ces assets restent « jamais utilisés » côté compte et ressortent en tête de rotation.",
  );

  section(`4. Assets jamais servis, créés depuis le ${AUTO_PACK_REMOVED_AT.toISOString().slice(0, 10)}`);
  const jamaisServis = await prisma.mediaAsset.findMany({
    where: { createdAt: { gte: AUTO_PACK_REMOVED_AT }, disabled: false, usages: { none: {} } },
    select: { libraryId: true, setTag: true, createdAt: true },
  });
  const parLib = new Map<string, { total: number; sansGroupe: number; depuis: Date }>();
  for (const a of jamaisServis) {
    const cur = parLib.get(a.libraryId) ?? { total: 0, sansGroupe: 0, depuis: a.createdAt };
    cur.total += 1;
    if (!a.setTag) cur.sansGroupe += 1;
    if (a.createdAt < cur.depuis) cur.depuis = a.createdAt;
    parLib.set(a.libraryId, cur);
  }
  const nomParId = new Map(libs.map((l) => [l.id, l.name]));
  for (const [libId, v] of [...parLib.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `  ${(nomParId.get(libId) ?? libId).padEnd(34).slice(0, 34)} jamais servis=${String(v.total).padStart(4)} ` +
        `(dont sans groupe ${String(v.sansGroupe).padStart(4)}) depuis ${v.depuis.toISOString().slice(0, 10)}`,
    );
  }
  console.log(`\n  → ${jamaisServis.length} asset(s) au total.`);

  section("5. Curseurs les plus anciens (rotation figée ?)");
  const curseurs = await prisma.accountLibraryCursor.findMany({
    select: {
      accountId: true, libraryId: true, cursor: true,
      lastUsedSetTag: true, lastUsedCategory: true, lastAdvancedAt: true,
    },
    orderBy: { lastAdvancedAt: "asc" },
    take: 25,
  });
  for (const c of curseurs) {
    console.log(
      `  ${(nomParId.get(c.libraryId) ?? c.libraryId).padEnd(28).slice(0, 28)} ` +
        `compte=${c.accountId.slice(0, 12).padEnd(12)} curseur=${String(c.cursor).padStart(3)} ` +
        `dernier=${c.lastUsedCategory ?? "—"}/${c.lastUsedSetTag ?? "—"} ` +
        `le=${c.lastAdvancedAt?.toISOString().slice(0, 10) ?? "jamais"}`,
    );
  }

  console.log("\nAudit terminé — aucune écriture effectuée.\n");
}

main()
  .catch((err) => {
    console.error("[audit-rotation] échec :", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
