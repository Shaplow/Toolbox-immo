/**
 * pg_dump backup script — run before any `prisma migrate deploy` in production.
 *
 * Usage (local, reads .env.local via dotenv-cli):
 *   cd web && npm run db:backup
 *
 * Usage (production, DATABASE_URL already in env):
 *   cd web && npx tsx scripts/db-backup.ts
 *
 * Output: web/backups/<YYYY-MM-DD_HH-mm-ss>_<dbName>.sql
 * Rotation: keeps the 20 most recent .sql files, deletes older ones.
 *
 * Requires pg_dump on PATH.
 *   macOS:  brew install postgresql
 *   Linux:  apt-get install -y postgresql-client
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

// ---------------------------------------------------------------------------
// 1. Check pg_dump availability
// ---------------------------------------------------------------------------

const pgDumpCheck = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
if (pgDumpCheck.error || pgDumpCheck.status !== 0) {
  console.error(
    "ERROR: pg_dump not found on PATH.\n" +
      "  macOS:  brew install postgresql\n" +
      "  Linux:  apt-get install -y postgresql-client"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Parse DATABASE_URL
// ---------------------------------------------------------------------------

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "ERROR: DATABASE_URL is not set.\n" +
      "  Run via  npm run db:backup  (loads .env.local automatically),\n" +
      "  or export DATABASE_URL before calling this script."
  );
  process.exit(1);
}

let parsed: url.URL;
try {
  parsed = new url.URL(databaseUrl);
} catch {
  console.error("ERROR: DATABASE_URL is not a valid URL:", databaseUrl);
  process.exit(1);
}

const host = parsed.hostname;
const port = parsed.port || "5432";
const dbName = parsed.pathname.replace(/^\//, "");
const user = parsed.username;
const password = decodeURIComponent(parsed.password);

if (!host || !dbName || !user) {
  console.error(
    "ERROR: Could not extract host/database/user from DATABASE_URL.\n" +
      "  Expected format: postgresql://user:password@host:port/dbname"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Build output path
// ---------------------------------------------------------------------------

const scriptDir = path.dirname(process.argv[1]);
const backupsDir = path.resolve(scriptDir, "..", "backups");

if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const timestamp =
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
  `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

const outputFile = path.join(backupsDir, `${timestamp}_${dbName}.sql`);

// ---------------------------------------------------------------------------
// 4. Run pg_dump
// ---------------------------------------------------------------------------

console.log(`Backing up database "${dbName}" from ${host}:${port}…`);

const result = spawnSync(
  "pg_dump",
  [
    "-h", host,
    "-p", port,
    "-U", user,
    "-d", dbName,
    "-f", outputFile,
    "--no-password",
  ],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      PGPASSWORD: password,
    },
  }
);

if (result.status !== 0) {
  // Clean up empty file if created
  if (fs.existsSync(outputFile)) {
    fs.unlinkSync(outputFile);
  }
  const stderr = (result.stderr || "").trim();
  console.error("ERROR: pg_dump failed.\n" + (stderr ? `  ${stderr}` : ""));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 5. Report success
// ---------------------------------------------------------------------------

const stats = fs.statSync(outputFile);
const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
console.log(`Backup written: ${outputFile}  (${sizeMb} MB)`);

// ---------------------------------------------------------------------------
// 6. Rotation — keep only the 20 most recent .sql files
// ---------------------------------------------------------------------------

const MAX_BACKUPS = 20;

const existingFiles = fs
  .readdirSync(backupsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => path.join(backupsDir, f))
  .sort(); // ISO timestamp prefix → lexicographic = chronological

if (existingFiles.length > MAX_BACKUPS) {
  const toDelete = existingFiles.slice(0, existingFiles.length - MAX_BACKUPS);
  for (const file of toDelete) {
    fs.unlinkSync(file);
    console.log(`Rotated old backup: ${file}`);
  }
}
