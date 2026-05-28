#!/usr/bin/env tsx
/**
 * Crée la base de données de test (toolbox_test) dans le container Docker
 * et applique les migrations Prisma.
 *
 * Usage :
 *   npm run test:db:setup        # crée si absent, applique migrations
 *   npm run test:db:reset        # drop + recreate (clean slate)
 *
 * Lit POSTGRES_HOST/USER/PASSWORD depuis .env.test (par défaut : valeurs
 * du container docker-compose.dev.yml — toolbox/toolbox sur localhost:5432).
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { config as loadEnv } from "dotenv";

// Charge .env.test ou fallback sur .env.local (pour les credentials Postgres
// — la DB cible reste toolbox_test, pas toolbox).
const scriptDir = dirname(new URL(import.meta.url).pathname);
const webDir = resolve(scriptDir, "..");
const envFile = existsSync(resolve(webDir, ".env.test"))
  ? resolve(webDir, ".env.test")
  : resolve(webDir, ".env.local");
loadEnv({ path: envFile, override: true });

const TEST_DB_NAME = "toolbox_test";
const PG_USER = process.env.POSTGRES_USER ?? "toolbox";
const PG_PASSWORD = process.env.POSTGRES_PASSWORD ?? "toolbox";
const PG_HOST = process.env.POSTGRES_HOST ?? "localhost";
const PG_PORT = process.env.POSTGRES_PORT ?? "5433";

const resetMode = process.argv.includes("--reset");

const psqlBase = `PGPASSWORD="${PG_PASSWORD}" psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER}`;

function run(cmd: string, opts: { silent?: boolean } = {}) {
  if (!opts.silent) console.log(`▶ ${cmd.replace(PG_PASSWORD, "***")}`);
  return execSync(cmd, { stdio: opts.silent ? "pipe" : "inherit", encoding: "utf-8" });
}

function checkPsql() {
  try {
    execSync("psql --version", { stdio: "pipe" });
  } catch {
    console.error("\n❌ psql introuvable. Installez postgresql-client :");
    console.error("   macOS : brew install postgresql");
    console.error("   Linux : apt-get install -y postgresql-client");
    process.exit(1);
  }
}

function dbExists(): boolean {
  try {
    const out = execSync(
      `${psqlBase} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${TEST_DB_NAME}'"`,
      { stdio: "pipe", encoding: "utf-8" }
    );
    return out.trim() === "1";
  } catch {
    return false;
  }
}

function dropDb() {
  console.log(`▶ DROP DATABASE ${TEST_DB_NAME} (avec close des connexions actives)`);
  // Tue les connexions actives avant le DROP
  run(
    `${psqlBase} -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${TEST_DB_NAME}' AND pid <> pg_backend_pid();"`,
    { silent: true }
  );
  run(`${psqlBase} -d postgres -c "DROP DATABASE IF EXISTS ${TEST_DB_NAME};"`);
}

function createDb() {
  console.log(`▶ CREATE DATABASE ${TEST_DB_NAME}`);
  run(`${psqlBase} -d postgres -c "CREATE DATABASE ${TEST_DB_NAME};"`);
}

function applyMigrations() {
  const testDbUrl = `postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${TEST_DB_NAME}`;
  // db push synchronise le schéma sans suivre l'historique des migrations —
  // adapté aux DB de test recréées de zéro à chaque run. Évite les
  // surprises liées à l'ordre alphabétique des dossiers de migrations
  // (ex : `20260526_xxx` qui se trie après `20260526131121_xxx` selon
  // ASCII et tombe au mauvais moment).
  console.log("▶ npx prisma db push (sur toolbox_test, sync schema sans historique)");
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    cwd: webDir,
    env: { ...process.env, DATABASE_URL: testDbUrl },
  });
}

// ── Main ────────────────────────────────────────────────────────────────────
checkPsql();

if (resetMode && dbExists()) {
  dropDb();
}

if (!dbExists()) {
  createDb();
}

applyMigrations();

console.log("\n✅ Test database prête : toolbox_test");
console.log(`   DATABASE_URL=postgresql://${PG_USER}:***@${PG_HOST}:${PG_PORT}/${TEST_DB_NAME}`);
console.log("\n   Pour seed des fixtures de test : npm run test:db:seed");
