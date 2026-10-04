/**
 * Transcription en lot — /transcriptions.
 *
 * Parcours : déposer plusieurs vidéos (un lot), régler « intervenants » pour
 * tout le lot, lancer le lot, télécharger le ZIP des SRT. Plus les garde-fous
 * serveur : isolation entre utilisateurs, PATCH partiel, « Lancer » pendant un
 * upload.
 *
 * Environnement e2e = mode local (pas de R2 ni de RunPod) : les uploads passent
 * par /upload-local (fichiers sous public/transcription/, nettoyés ici), et le
 * lancement échoue faute de render-engine — on vérifie la transition, pas la
 * transcription. Les ZIP se testent sur des jobs seedés avec segments inline.
 */

import { readFileSync, rmSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import JSZip from "jszip";
import { loginAs, TEST_USERS, type TestUserKey } from "./fixtures/auth";

const prismaTest = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL ?? "postgresql://toolbox:toolbox@localhost:5433/toolbox_test",
    },
  },
});

const RUSH = readFileSync(path.join(__dirname, "fixtures/test-rush.mp4"));

const SEGMENTS_WITH_SPEAKER = JSON.stringify([
  { start: 0, end: 1.2, text: "Bonjour et bienvenue", speaker: "SPEAKER_00" },
  { start: 1.4, end: 2.5, text: "dans cette villa", speaker: "SPEAKER_01" },
]);

async function userIdOf(key: TestUserKey): Promise<string> {
  const user = await prismaTest.user.findUniqueOrThrow({ where: { username: TEST_USERS[key].username } });
  return user.id;
}

async function cleanup(userId: string) {
  await prismaTest.transcriptionJob.deleteMany({ where: { userId } });
  // Uploads du mode local (cf. api/transcription/route.ts, chemin `local/`).
  rmSync(path.join(__dirname, "..", "public", "transcription", userId), { recursive: true, force: true });
}

async function seedCompletedBatch(userId: string, filenames: string[]) {
  const batchId = randomUUID();
  for (const [index, inputFilename] of filenames.entries()) {
    await prismaTest.transcriptionJob.create({
      data: {
        userId,
        batchId,
        status: "COMPLETED",
        inputFilename,
        uploadedAt: new Date(),
        segmentsJson: SEGMENTS_WITH_SPEAKER,
        segmentCount: 2,
        duration: 2.5,
        hasDiarization: true,
        enableDiarization: true,
        createdAt: new Date(Date.now() - (filenames.length - index) * 1000),
      },
    });
  }
  return batchId;
}

test.describe("Transcription en lot", () => {
  let monteurId: string;
  let cmId: string;

  test.beforeAll(async () => {
    monteurId = await userIdOf("monteur");
    cmId = await userIdOf("cm");
  });

  test.beforeEach(async () => {
    await cleanup(monteurId);
    await cleanup(cmId);
  });

  test.afterAll(async () => {
    await cleanup(monteurId);
    await cleanup(cmId);
    await prismaTest.$disconnect();
  });

  test("dépôt de 3 vidéos → un lot prêt, intervenants pour tout le lot, lancement en un clic", async ({ page }) => {
    await loginAs(page, "monteur");
    await page.goto("/transcriptions");

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles([
        { name: "visite-salon.mp4", mimeType: "video/mp4", buffer: RUSH },
        { name: "visite-cuisine.mp4", mimeType: "video/mp4", buffer: RUSH },
        { name: "visite-jardin.mp4", mimeType: "video/mp4", buffer: RUSH },
      ]);

    await expect(page.getByText("3 prêtes", { exact: true })).toBeVisible({ timeout: 20_000 });
    const jobs = await prismaTest.transcriptionJob.findMany({ where: { userId: monteurId } });
    expect(jobs).toHaveLength(3);
    expect(new Set(jobs.map((job) => job.batchId)).size).toBe(1);
    expect(jobs[0].batchId).not.toBeNull();
    expect(jobs.every((job) => job.uploadedAt !== null && job.status === "QUEUED")).toBe(true);

    // Intervenants pour tout le lot : un geste, toutes les vidéos.
    await page.getByRole("checkbox", { name: /Identifier les intervenants pour toutes les vidéos/ }).click();
    await expect
      .poll(async () =>
        (await prismaTest.transcriptionJob.findMany({ where: { userId: monteurId } })).every(
          (job) => job.enableDiarization,
        ),
      )
      .toBe(true);

    await page.getByRole("button", { name: "Lancer les 3 prêtes" }).click();
    await expect(page.getByText("3 transcriptions lancées")).toBeVisible();
    // Plus aucune vidéo en attente (sans render-engine en e2e, elles finissent en échec).
    await expect
      .poll(async () =>
        (await prismaTest.transcriptionJob.findMany({ where: { userId: monteurId } })).every(
          (job) => job.status !== "QUEUED",
        ),
      )
      .toBe(true);
  });

  test("ZIP des SRT d'un lot : un fichier par vidéo, homonymes dédoublonnés, intervenants", async ({ page }) => {
    const batchId = await seedCompletedBatch(monteurId, ["IMG_0001.MOV", "IMG_0001.MOV", "Visite été.mp4"]);
    await loginAs(page, "monteur");

    const res = await page.request.get(`/api/transcription/batches/${batchId}/download?format=srt`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/zip");
    expect(res.headers()["x-transcription-errors"]).toBe("0");
    const zip = await JSZip.loadAsync(await res.body());
    expect(Object.keys(zip.files).sort()).toEqual(["IMG_0001 (2).srt", "IMG_0001.srt", "Visite été.srt"]);
    const srt = await zip.file("Visite été.srt")!.async("string");
    expect(srt).toContain("[SPEAKER_00] Bonjour et bienvenue");

    const json = await page.request.get(`/api/transcription/batches/${batchId}/download?format=json`);
    expect(json.status()).toBe(200);
    expect(Object.keys((await JSZip.loadAsync(await json.body())).files)).toContain("Visite été.json");

    // Même chose depuis l'UI : un clic, un ZIP.
    await page.goto("/transcriptions");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Télécharger les SRT (3)" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^transcriptions-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}-srt\.zip$/);
  });

  test("SRT d'une vidéo en un clic depuis sa ligne", async ({ page }) => {
    await seedCompletedBatch(monteurId, ["Visite été.mp4"]);
    await loginAs(page, "monteur");
    await page.goto("/transcriptions");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "SRT", exact: true }).click();
    expect((await downloadPromise).suggestedFilename()).toBe("Visite été.srt");
  });

  test("isolation : le lot d'un autre utilisateur est introuvable", async ({ page }) => {
    const batchId = await seedCompletedBatch(monteurId, ["prive.mp4"]);
    await loginAs(page, "cm");

    expect((await page.request.get(`/api/transcription/batches/${batchId}/download`)).status()).toBe(404);
    expect((await page.request.post(`/api/transcription/batches/${batchId}/launch`, { data: {} })).status()).toBe(404);
    const patch = await page.request.patch(`/api/transcription/batches/${batchId}`, {
      data: { enable_diarization: false },
    });
    expect(await patch.json()).toEqual({ updated: 0 });
    const workspace = (await (await page.request.get("/api/transcription/batches")).json()) as {
      jobs: { batchId: string | null }[];
    };
    expect(workspace.jobs.some((job) => job.batchId === batchId)).toBe(false);
  });

  test("PATCH partiel : un champ absent n'est plus réinitialisé", async ({ page }) => {
    const job = await prismaTest.transcriptionJob.create({
      data: { userId: monteurId, status: "QUEUED", model: "large-v3", enableDiarization: true, language: "fr" },
    });
    await loginAs(page, "monteur");
    const res = await page.request.patch(`/api/transcription/${job.id}`, { data: { language: "en" } });
    expect(res.status()).toBe(200);
    const after = await prismaTest.transcriptionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toMatchObject({ language: "en", model: "large-v3", enableDiarization: true });
  });

  test("« Lancer » pendant l'upload : 409 UPLOAD_PENDING, la vidéo reste en attente", async ({ page }) => {
    const job = await prismaTest.transcriptionJob.create({
      data: {
        userId: monteurId,
        status: "QUEUED",
        inputKey: `local/transcription/${monteurId}/pending-${Date.now()}/source.mp4`,
        inputFilename: "en-cours.mp4",
      },
    });
    await loginAs(page, "monteur");
    const res = await page.request.post(`/api/transcription/${job.id}/submit`);
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe("UPLOAD_PENDING");
    expect((await prismaTest.transcriptionJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("QUEUED");
  });
});
