#!/usr/bin/env tsx
/**
 * Seed minimal pour la base de test (toolbox_test).
 * Crée les fixtures partagées par les tests E2E :
 * - 1 admin (admin@test.local / testpass)
 * - 1 monteur (monteur@test.local / testpass)
 * - 1 CM (cm@test.local / testpass)
 * - 1 user legacy avec permissions ["captions"] (user@test.local / testpass)
 * - 1 client + 1 InstagramAccount rattaché
 * - 1 ContentRecipe minimale ("RPI" auto_template)
 * - 1 PublicationSlot assigné au monteur ET au CM (pour tester les 2 rôles)
 *
 * Idempotent : utilise upsert sur les emails uniques + cuid déterministes
 * pour permettre des relances multiples sans dupliquer.
 *
 * Usage :
 *   npm run test:db:seed         # seed sans reset
 *   npm run test:db:reset && npm run test:db:setup && npm run test:db:seed
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { dirname, resolve } from "path";
import { existsSync } from "fs";
import { config as loadEnv } from "dotenv";

const scriptDir = dirname(new URL(import.meta.url).pathname);
const webDir = resolve(scriptDir, "..");
const envFile = existsSync(resolve(webDir, ".env.test"))
  ? resolve(webDir, ".env.test")
  : resolve(webDir, ".env.local");
loadEnv({ path: envFile, override: true });

const TEST_PASSWORD_HASH = bcrypt.hashSync("testpass", 4);

// Force la DATABASE_URL vers toolbox_test au cas où .env.test pointe ailleurs
const PG_USER = process.env.POSTGRES_USER ?? "toolbox";
const PG_PASSWORD = process.env.POSTGRES_PASSWORD ?? "toolbox";
const PG_HOST = process.env.POSTGRES_HOST ?? "localhost";
const PG_PORT = process.env.POSTGRES_PORT ?? "5433";
process.env.DATABASE_URL = `postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/toolbox_test`;

const prisma = new PrismaClient();

async function main() {
  console.log("▶ Seed test DB (idempotent)...");

  // ── Users ─────────────────────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: "admin@test.local" },
    update: { role: "ADMIN" },
    create: {
      email: "admin@test.local",
      username: "test_admin",
      name: "Test Admin",
      passwordHash: TEST_PASSWORD_HASH,
      role: "ADMIN",
      permissions: "[]",
    },
  });

  const monteur = await prisma.user.upsert({
    where: { email: "monteur@test.local" },
    update: { role: "MONTEUR" },
    create: {
      email: "monteur@test.local",
      username: "test_monteur",
      name: "Test Monteur",
      passwordHash: TEST_PASSWORD_HASH,
      role: "MONTEUR",
      permissions: JSON.stringify(["captions", "transcription"]),
    },
  });

  const cm = await prisma.user.upsert({
    where: { email: "cm@test.local" },
    update: { role: "CM" },
    create: {
      email: "cm@test.local",
      username: "test_cm",
      name: "Test CM",
      passwordHash: TEST_PASSWORD_HASH,
      role: "CM",
      permissions: JSON.stringify(["captions", "transcription", "description", "covers"]),
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "user@test.local" },
    update: { role: "USER" },
    create: {
      email: "user@test.local",
      username: "test_user",
      name: "Test User",
      passwordHash: TEST_PASSWORD_HASH,
      role: "USER",
      permissions: JSON.stringify(["captions"]),
    },
  });

  console.log(`  ✓ Users : admin=${admin.id}, monteur=${monteur.id}, cm=${cm.id}, user=${user.id}`);

  // ── Client + InstagramAccount ─────────────────────────────────────────────
  const client = await prisma.client.upsert({
    where: { id: "test-client-1" },
    update: {},
    create: {
      id: "test-client-1",
      name: "Test Client",
      contactName: "Contact Test",
      email: "client@test.local",
      phone: null,
    },
  });

  const account = await prisma.instagramAccount.upsert({
    where: { handle: "test_account" },
    update: { clientId: client.id },
    create: {
      name: "Test Account",
      handle: "test_account",
      offre: "ESSENTIEL",
      clientId: client.id,
    },
  });

  console.log(`  ✓ Client + Account : client=${client.id}, account=${account.id}`);

  // ── Offer (requis par OfferScheduleRule, et apparaît dans /admin/offers) ─
  await prisma.offer.upsert({
    where: { name: "ESSENTIEL" },
    update: {},
    create: { name: "ESSENTIEL" },
  });

  // ── ContentRecipe minimale ────────────────────────────────────────────────
  const recipe = await prisma.contentRecipe.upsert({
    where: { code: "TEST_RPI" },
    update: {
      defaultAssigneeMonteurId: monteur.id,
      defaultAssigneeCmId: cm.id,
    },
    create: {
      code: "TEST_RPI",
      label: "Test RPI (E2E fixture)",
      source: "auto_template",
      needsDescription: "autoGenerate",
      needsCover: "auto",
      needsCaptions: true,
      needsClientValidation: false,
      needsRushes: true,
      needsBrief: true,
      defaultAssigneeMonteurId: monteur.id,
      defaultAssigneeCmId: cm.id,
    },
  });

  console.log(`  ✓ Recipe : ${recipe.id}`);

  // ── PublicationSlot ───────────────────────────────────────────────────────
  // 1 slot ASSIGNÉ au monteur + au CM (les tests vérifient l'accès des 2)
  const scheduledAt = new Date();
  scheduledAt.setDate(scheduledAt.getDate() + 3); // dans 3 jours
  scheduledAt.setHours(19, 0, 0, 0);

  const slot = await prisma.publicationSlot.upsert({
    where: { id: "test-slot-1" },
    update: {
      assigneeMonteurId: monteur.id,
      assigneeCmId: cm.id,
      recipeId: recipe.id,
      accountId: account.id,
    },
    create: {
      id: "test-slot-1",
      accountId: account.id,
      recipeId: recipe.id,
      contentType: "TEST_RPI",
      scheduledAt,
      status: "PLANNED",
      title: "Test slot E2E",
      caption: "Caption de test pour fiche publication.",
      description: "Description de test injectée par seed.",
      assigneeMonteurId: monteur.id,
      assigneeCmId: cm.id,
      isAuto: false,
    },
  });

  // 1 slot NON-ASSIGNÉ (pour tester l'isolation : monteur ne doit pas le voir)
  const orphanScheduled = new Date();
  orphanScheduled.setDate(orphanScheduled.getDate() + 5);

  await prisma.publicationSlot.upsert({
    where: { id: "test-slot-orphan" },
    update: {},
    create: {
      id: "test-slot-orphan",
      accountId: account.id,
      recipeId: recipe.id,
      contentType: "TEST_RPI",
      scheduledAt: orphanScheduled,
      status: "DRAFT",
      title: "Test slot orphelin (ne doit PAS être vu par monteur/cm de test)",
      isAuto: false,
    },
  });

  console.log(`  ✓ Slots : assigné=${slot.id}, orphelin=test-slot-orphan`);

  console.log("\n✅ Seed test DB terminé.");
  console.log("\n   Credentials (tous : password=testpass) :");
  console.log("   - admin@test.local    (ADMIN)");
  console.log("   - monteur@test.local  (MONTEUR, assigné slot test-slot-1)");
  console.log("   - cm@test.local       (CM, assigné slot test-slot-1)");
  console.log("   - user@test.local     (USER, permission captions)");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
