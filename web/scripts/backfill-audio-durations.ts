/**
 * Backfill MediaAsset.duration for all audio assets that don't have one yet.
 *
 * Usage sur le serveur de prod (depuis /var/www/toolbox/web) :
 *   apt-get install -y ffmpeg          # une seule fois si pas déjà installé
 *   npx dotenv -e .env.local -- tsx scripts/backfill-audio-durations.ts
 *
 * Usage en local (si ffprobe installé) :
 *   cd web && npx dotenv -e .env.local -- tsx scripts/backfill-audio-durations.ts
 */

import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Répertoire public servi par Next.js — pour résoudre les chemins relatifs /uploads/…
// import.meta.dirname n'est dispo qu'en Node 21+ ; process.argv[1] fonctionne partout.
const PUBLIC_DIR = path.join(path.dirname(process.argv[1]), "..", "public");

function resolveUrl(url: string): string {
  // Ancien format : chemin relatif /uploads/xxx.mp3 → chemin absolu sur disque
  if (url.startsWith("/")) {
    return path.join(PUBLIC_DIR, url);
  }
  // Nouveau format : URL R2 complète
  return url;
}

function probeDuration(urlOrPath: string): number | null {
  // Si c'est un chemin local qui n'existe pas, on ne tente pas ffprobe
  if (!urlOrPath.startsWith("http") && !fs.existsSync(urlOrPath)) {
    return null;
  }
  try {
    const raw = execSync(
      `ffprobe -v error -show_entries format=duration -of json "${urlOrPath}"`,
      { timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] },
    ).toString();
    const parsed = JSON.parse(raw) as { format?: { duration?: string } };
    const d = parseFloat(parsed.format?.duration ?? "");
    return isNaN(d) || d <= 0 ? null : d;
  } catch {
    return null;
  }
}

async function main() {
  try {
    execSync("ffprobe -version", { stdio: "ignore" });
  } catch {
    console.error("ffprobe introuvable. Installe ffmpeg : apt-get install -y ffmpeg");
    process.exit(1);
  }

  const assets = await prisma.mediaAsset.findMany({
    where: { duration: null, library: { type: "audio" } },
    select: { id: true, url: true, filename: true },
    orderBy: { createdAt: "asc" },
  });

  if (assets.length === 0) {
    console.log("Tous les assets audio ont déjà une durée.");
    return;
  }

  console.log(`${assets.length} asset(s) audio sans durée. Probe en cours...\n`);

  let ok = 0, failed = 0;
  for (const asset of assets) {
    const resolved = resolveUrl(asset.url);
    const duration = probeDuration(resolved);
    if (duration !== null) {
      await prisma.mediaAsset.update({ where: { id: asset.id }, data: { duration } });
      console.log(`  ✓  ${asset.filename}  →  ${duration.toFixed(1)}s`);
      ok++;
    } else {
      console.warn(`  ✗  ${asset.filename}  →  probe échoué  (${resolved})`);
      failed++;
    }
  }

  console.log(`\nTerminé. ${ok} mis à jour, ${failed} échoués.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
