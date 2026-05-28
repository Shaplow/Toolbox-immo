#!/usr/bin/env tsx
/**
 * Seed minimal pour la base de test (toolbox_test).
 * Crée les fixtures partagées par les tests E2E :
 * - 1 admin (admin@test.local / testpass)
 * - 1 monteur (monteur@test.local / testpass)
 * - 1 CM (cm@test.local / testpass)
 * - 1 client externe (EXTERNAL_GENERATOR) avec permissions ["captions"] (user@test.local / testpass)
 * - 1 client + 1 InstagramAccount rattaché
 * - 1 AccountPattern minimale ("RPI" auto_template)
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

  const videaste = await prisma.user.upsert({
    where: { email: "videaste@test.local" },
    update: { role: "VIDEASTE" },
    create: {
      email: "videaste@test.local",
      username: "test_videaste",
      name: "Test Vidéaste",
      passwordHash: TEST_PASSWORD_HASH,
      role: "VIDEASTE",
      permissions: "[]",
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "user@test.local" },
    update: { role: "EXTERNAL_GENERATOR" },
    create: {
      email: "user@test.local",
      username: "test_user",
      name: "Test User",
      passwordHash: TEST_PASSWORD_HASH,
      role: "EXTERNAL_GENERATOR",
      permissions: JSON.stringify(["captions"]),
    },
  });

  console.log(`  ✓ Users : admin=${admin.id}, monteur=${monteur.id}, cm=${cm.id}, videaste=${videaste.id}, user=${user.id}`);

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
    update: { client: { connect: { id: client.id } } },
    create: {
      name: "Test Account",
      handle: "test_account",
      client: { connect: { id: client.id } },
    },
  });

  console.log(`  ✓ Client + Account : client=${client.id}, account=${account.id}`);

  // ── AccountPattern minimale (remplace ContentRecipe) ────────────────────
  const pattern = await prisma.accountPattern.upsert({
    where: { id: "test-pattern-1" },
    update: {
      defaultAssigneeMonteurId: monteur.id,
      defaultAssigneeCmId: cm.id,
    },
    create: {
      id: "test-pattern-1",
      accountId: account.id,
      label: "Test Pattern (E2E fixture)",
      source: "auto_template",
      needsDescription: "autoGenerate",
      needsCaptions: true,
      needsClientValidation: false,
      needsRushes: true,
      needsBrief: true,
      dayOfWeek: [1],
      publishTime: "09:00",
      defaultAssigneeMonteurId: monteur.id,
      defaultAssigneeCmId: cm.id,
    },
  });

  console.log(`  ✓ Pattern : ${pattern.id}`);

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
      assigneeVideasteId: videaste.id,
      patternId: pattern.id,
      accountId: account.id,
    },
    create: {
      id: "test-slot-1",
      accountId: account.id,
      patternId: pattern.id,
      scheduledAt,
      status: "PLANNED",
      title: "Test slot E2E",
      caption: "Caption de test pour fiche publication.",
      description: "Description de test injectée par seed.",
      assigneeMonteurId: monteur.id,
      assigneeCmId: cm.id,
      assigneeVideasteId: videaste.id,
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
      patternId: pattern.id,
      scheduledAt: orphanScheduled,
      status: "DRAFT",
      title: "Test slot orphelin (ne doit PAS être vu par monteur/cm de test)",
      isAuto: false,
    },
  });

  console.log(`  ✓ Slots : assigné=${slot.id}, orphelin=test-slot-orphan`);

  // ─── MediaLibrary + MediaAsset (pour Playwright screenshots D-SETUP) ──────
  // Library vidéo "Test Videos" avec 3 assets fictifs (URLs locales, jamais
  // chargées par les screenshot tests — preview désactivée via LazyVideoThumb
  // IntersectionObserver) + library audio "Test Audio" avec 2 musiques.

  const videoLib = await prisma.mediaLibrary.upsert({
    where: { id: "test-media-lib-video" },
    update: {},
    create: {
      id: "test-media-lib-video",
      name: "Test Videos",
      type: "video",
      setSequence: JSON.stringify(["INTRO", "OUTRO"]),
      metadataSchema: JSON.stringify([]),
    },
  });

  const audioLib = await prisma.mediaLibrary.upsert({
    where: { id: "test-media-lib-audio" },
    update: {},
    create: {
      id: "test-media-lib-audio",
      name: "Test Audio",
      type: "audio",
      setSequence: JSON.stringify([]),
      metadataSchema: JSON.stringify([]),
    },
  });

  // Assets vidéo : 3 fichiers avec set tags + tags + categories différents
  for (const [i, spec] of [
    { setTag: "INTRO", category: "Tenue 1", tags: ["intro", "extérieur"] },
    { setTag: "OUTRO", category: "Tenue 1", tags: ["outro", "extérieur"] },
    { setTag: "INTRO", category: "Tenue 2", tags: ["intro", "intérieur"] },
  ].entries()) {
    await prisma.mediaAsset.upsert({
      where: { id: `test-media-asset-video-${i}` },
      update: {},
      create: {
        id: `test-media-asset-video-${i}`,
        libraryId: videoLib.id,
        filename: `test_video_${i}.mp4`,
        r2Key: `test-fixtures/video_${i}.mp4`,
        url: `/test-fixtures/video_${i}.mp4`,
        mimeType: "video/mp4",
        duration: 5.0 + i,
        tags: JSON.stringify(spec.tags),
        setTag: spec.setTag,
        category: spec.category,
        usageCount: i,
      },
    });
  }

  // Assets audio : 2 musiques
  for (const i of [0, 1]) {
    await prisma.mediaAsset.upsert({
      where: { id: `test-media-asset-audio-${i}` },
      update: {},
      create: {
        id: `test-media-asset-audio-${i}`,
        libraryId: audioLib.id,
        filename: `test_audio_${i}.mp3`,
        r2Key: `test-fixtures/audio_${i}.mp3`,
        url: `/test-fixtures/audio_${i}.mp3`,
        mimeType: "audio/mpeg",
        duration: 30.0 + i * 10,
        tags: JSON.stringify([]),
        usageCount: 0,
      },
    });
  }

  console.log(`  ✓ MediaLibraries : video=${videoLib.id}, audio=${audioLib.id}`);

  console.log("\n✅ Seed test DB terminé.");
  console.log("\n   Credentials (tous : password=testpass) :");
  console.log("   - admin@test.local      (ADMIN)");
  console.log("   - monteur@test.local    (MONTEUR, assigné slot test-slot-1)");
  console.log("   - cm@test.local         (CM, assigné slot test-slot-1)");
  console.log("   - videaste@test.local   (VIDEASTE, assigné slot test-slot-1)");
  console.log("   - user@test.local       (EXTERNAL_GENERATOR, permission captions)");
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
