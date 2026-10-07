/**
 * Rétention des vidéos sous-titrées de l'Atelier — téléchargement qui enregistre
 * l'activité, ligne « Expirée » dans « Mes générations ».
 *
 * Environnement e2e = stockage local (pas de R2) : chaque ligne porte une `outputUrl`
 * /api/captions/…, que la route de téléchargement renvoie telle quelle en 302 (même si
 * la ligne a une clé : R2 n'est pas configuré, la route retombe sur cette URL). La purge
 * elle-même (suppression R2) est couverte par les tests unitaires du service ; ici on
 * vérifie ce que voit et obtient l'utilisateur.
 *
 * Fixtures dédiées (suffixe RUN), sous-titrages de l'utilisateur monteur. Celles qui sont
 * soumises à la rétention, ou qui le seraient sans la règle d'exclusion qu'elles testent,
 * portent une clé R2 de la forme réelle (`outputs/captions/<user>/<ts>/full.mp4`) : sans
 * clé reconnue aucun job n'est purgé, et l'absence de date ne prouverait rien.
 *   available    Atelier terminé, jamais téléchargé : fin de garde annoncée
 *   expired      vidéo supprimée par la purge, ligne gardée en historique
 *   failed       job en échec qui porte une date de purge : reste « Échec », jamais « Expirée »
 *   overdue      Atelier de 70 jours que la purge de la nuit n'a pas encore pris : échéance
 *                passée, donc aucune date annoncée
 *   auto         pipeline auto (« auto-<id>.json ») : jamais purgé, lien sans promesse de durée
 *   publication  lié à une publication : jamais purgé, lien sans promesse de durée
 *   nofile       terminé, mais la route ne sait pas servir son fichier : pas de lien
 */

import { randomUUID } from "crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAs, TEST_USERS } from "./fixtures/auth";

const prismaTest = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL ?? "postgresql://toolbox:toolbox@localhost:5433/toolbox_test",
    },
  },
});

const RUN = randomUUID().slice(0, 6);
const ID_PREFIX = "e2e-capret-";
const DAY_MS = 24 * 60 * 60 * 1000;

const ids = {
  available: `${ID_PREFIX}ok-${RUN}`,
  expired: `${ID_PREFIX}exp-${RUN}`,
  failed: `${ID_PREFIX}fail-${RUN}`,
  overdue: `${ID_PREFIX}late-${RUN}`,
  auto: `${ID_PREFIX}auto-${RUN}`,
  publication: `${ID_PREFIX}pub-${RUN}`,
  nofile: `${ID_PREFIX}nofile-${RUN}`,
  slot: `${ID_PREFIX}slot-${RUN}`,
};

// Le titre d'une ligne de l'historique est le nom de fichier de `inputUrl`, sans extension.
const titles = {
  available: `visite-dispo-${RUN}`,
  expired: `visite-expiree-${RUN}`,
  failed: `visite-echec-${RUN}`,
  overdue: `visite-ancienne-${RUN}`,
  auto: `visite-auto-${RUN}`,
  publication: `visite-publication-${RUN}`,
  nofile: `visite-sans-fichier-${RUN}`,
};

const localVideoUrl = `/api/captions/outputs/temp/${RUN}/full.mp4`;
const downloadPath = (id: string) => `/api/render/captions/${id}/download`;

/** Clé R2 d'une vidéo de l'Atelier, de la forme que l'app écrit et que la rétention reconnaît. */
const atelierKey = (userId: string) => `outputs/captions/${userId}/${Date.now()}/full.mp4`;

/** Ligne de l'historique (un <a>) portant ce titre. */
const rowOf = (page: Page, title: string) => page.locator("a", { hasText: title });

async function seedFixtures() {
  const monteur = await prismaTest.user.findUniqueOrThrow({ where: { username: TEST_USERS.monteur.username } });
  const common = {
    userId: monteur.id,
    status: "COMPLETED",
    slotId: null,
    srtFilename: "captions.json",
    srtContent: "[]",
  };
  const seventyDaysAgo = new Date(Date.now() - 70 * DAY_MS);

  await prismaTest.captionJob.create({
    data: {
      ...common,
      id: ids.available,
      inputUrl: `/uploads/${titles.available}.mp4`,
      outputKey: atelierKey(monteur.id),
      outputUrl: localVideoUrl,
    },
  });
  // Vidéo supprimée par la purge : plus d'URL, `outputExpiredAt` posé, ligne gardée.
  await prismaTest.captionJob.create({
    data: {
      ...common,
      id: ids.expired,
      inputUrl: `/uploads/${titles.expired}.mp4`,
      outputUrl: null,
      outputExpiredAt: new Date(),
      createdAt: seventyDaysAgo,
    },
  });
  // La purge couvre aussi les jobs en échec : la date est posée, la ligne reste « Échec ».
  await prismaTest.captionJob.create({
    data: {
      ...common,
      id: ids.failed,
      status: "FAILED",
      errorMsg: "Le rendu a échoué",
      inputUrl: `/uploads/${titles.failed}.mp4`,
      outputUrl: null,
      outputExpiredAt: new Date(),
      createdAt: seventyDaysAgo,
    },
  });
  // La vidéo a 70 jours : l'échéance est passée de 10 jours, mais elle n'est pas encore supprimée.
  await prismaTest.captionJob.create({
    data: {
      ...common,
      id: ids.overdue,
      inputUrl: `/uploads/${titles.overdue}.mp4`,
      outputKey: atelierKey(monteur.id),
      outputUrl: localVideoUrl,
      createdAt: seventyDaysAgo,
    },
  });
  // Pipeline auto : `inputUrl` est une URL absolue, `srtFilename` « auto-<id>.json ». La clé a
  // la forme d'une vidéo de l'Atelier : seul le nom des sous-titres écarte ce job de la purge.
  await prismaTest.captionJob.create({
    data: {
      ...common,
      id: ids.auto,
      srtFilename: `auto-cmx${RUN}.json`,
      inputUrl: `https://cdn.example.test/inputs/${titles.auto}.mp4?sig=abc`,
      outputKey: atelierKey(monteur.id),
      outputUrl: localVideoUrl,
    },
  });
  // Publication : un slot dédié, sans compte (une « mission » en stock). Même remarque que
  // pour l'auto : seul le lien au slot écarte ce job de la purge.
  await prismaTest.publicationSlot.create({ data: { id: ids.slot, title: `Publication ${RUN}` } });
  await prismaTest.captionJob.create({
    data: {
      ...common,
      id: ids.publication,
      slotId: ids.slot,
      inputUrl: `/uploads/${titles.publication}.mp4`,
      outputKey: atelierKey(monteur.id),
      outputUrl: localVideoUrl,
    },
  });
  // Ni clé R2, ni URL du bucket public, ni proxy local : la route répondrait 404.
  await prismaTest.captionJob.create({
    data: {
      ...common,
      id: ids.nofile,
      inputUrl: `/uploads/${titles.nofile}.mp4`,
      outputUrl: `https://elsewhere.example.test/${RUN}/full.mp4`,
    },
  });
}

async function cleanupFixtures() {
  // Les jobs d'abord : supprimer le slot les détacherait (SetNull) sans les effacer.
  await prismaTest.captionJob.deleteMany({ where: { id: { startsWith: ID_PREFIX } } });
  await prismaTest.publicationSlot.deleteMany({ where: { id: { startsWith: ID_PREFIX } } });
}

/** Ouvre « Mes générations » sur l'onglet Captions, filtré sur les fixtures de ce run. */
async function openCaptionsTab(page: Page) {
  await loginAs(page, "monteur");
  await page.goto("/listings");

  // Un clic avant l'hydratation de la page ne change pas d'onglet : on le rejoue.
  await expect(async () => {
    await page.getByRole("button", { name: /^Captions/ }).click();
    await expect(rowOf(page, titles.available)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  // La recherche écarte les autres sous-titrages de l'utilisateur (et la pagination).
  await page.getByPlaceholder("Rechercher (titre, template, user)").fill(RUN);
}

test.describe("Rétention des vidéos sous-titrées de l'Atelier", () => {
  test.beforeAll(async () => {
    await cleanupFixtures();
    await seedFixtures();
  });

  test.beforeEach(async () => {
    // Chaque test part d'une vidéo jamais téléchargée.
    await prismaTest.captionJob.update({ where: { id: ids.available }, data: { lastAccessedAt: null } });
  });

  test.afterAll(async () => {
    await cleanupFixtures();
    await prismaTest.$disconnect();
  });

  test("le téléchargement redirige vers le fichier et enregistre l'activité", async ({ page }) => {
    await loginAs(page, "monteur");

    const before = new Date();
    const res = await page.request.get(downloadPath(ids.available), { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = res.headers()["location"] ?? "";
    expect(new URL(location, "http://localhost").pathname).toBe(localVideoUrl);

    const job = await prismaTest.captionJob.findUniqueOrThrow({ where: { id: ids.available } });
    expect(job.lastAccessedAt).not.toBeNull();
    expect(job.lastAccessedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(job.outputExpiredAt).toBeNull();
  });

  test("une vidéo expirée répond 410 et ne compte pas comme activité", async ({ page }) => {
    await loginAs(page, "monteur");

    const res = await page.request.get(downloadPath(ids.expired), { maxRedirects: 0 });
    expect(res.status()).toBe(410);
    const body = (await res.json()) as { error?: string; expired?: boolean };
    expect(body.expired).toBe(true);
    expect(body.error).toMatch(/supprimée/);

    const job = await prismaTest.captionJob.findUniqueOrThrow({ where: { id: ids.expired } });
    expect(job.lastAccessedAt).toBeNull();
    expect(job.outputExpiredAt).not.toBeNull();
  });

  test("« Mes générations » : durée de garde dite en clair, badge « Expirée » sur la vidéo supprimée seulement", async ({ page }) => {
    // Premier accès à /listings en `next dev` : la compilation peut être longue.
    test.setTimeout(60_000);
    await openCaptionsTab(page);

    // Le rappel de la durée de garde est du texte visible, pas une info-bulle.
    const notice = page.getByText(/gardées 60 jours après leur génération ou ton dernier téléchargement/);
    await expect(notice).toBeVisible();

    // Disponible : lien de téléchargement par la route, fin de garde en info-bulle, pas de badge.
    const availableRow = rowOf(page, titles.available);
    const downloadLink = availableRow.locator(`a[href="${downloadPath(ids.available)}"]`);
    await expect(downloadLink).toHaveAttribute("download", "");
    await expect(downloadLink).toHaveAttribute("title", /Disponible au moins jusqu'au/);
    await expect(availableRow.getByText("Expirée")).toHaveCount(0);

    // Expirée : la raison est écrite sous le titre, le badge la détaille au survol,
    // et plus aucun lien de téléchargement.
    const expiredRow = rowOf(page, titles.expired);
    await expect(expiredRow.getByText("Vidéo supprimée après 60 jours sans téléchargement", { exact: true })).toBeVisible();
    const badge = expiredRow.getByText("Expirée", { exact: true });
    await expect(badge).toBeVisible();
    await expect(page.locator(`a[href="${downloadPath(ids.expired)}"]`)).toHaveCount(0);
    await badge.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText("relance la génération");
    // Texte long : la bulle passe à la ligne au lieu de s'étirer sur une seule (max-w-xs = 320 px).
    const bubble = await tooltip.boundingBox();
    expect(bubble).not.toBeNull();
    expect(bubble!.width).toBeLessThanOrEqual(320);

    // En échec : jamais « Expirée », même avec une date de purge posée.
    const failedRow = rowOf(page, titles.failed);
    await expect(failedRow.getByText("Échec", { exact: true })).toBeVisible();
    await expect(failedRow.getByText("Expirée")).toHaveCount(0);
    await expect(failedRow.getByText(/Vidéo supprimée/)).toHaveCount(0);

    // Le rappel ne concerne que cet onglet.
    await page.getByRole("button", { name: /^Générations/ }).click();
    await expect(notice).toHaveCount(0);
  });

  test("sans purge à annoncer, le lien de téléchargement reste simple, ou n'existe pas", async ({ page }) => {
    test.setTimeout(60_000);
    await openCaptionsTab(page);

    // Pipeline auto, publication, échéance déjà passée : aucune promesse de durée.
    for (const key of ["auto", "publication", "overdue"] as const) {
      const link = rowOf(page, titles[key]).locator(`a[href="${downloadPath(ids[key])}"]`);
      await expect(link, `lien de la ligne « ${key} »`).toHaveAttribute("title", "Télécharger la vidéo");
    }

    // Terminé, mais la route ne saurait pas servir ce fichier : pas de lien qui finirait en 404.
    const nofileRow = rowOf(page, titles.nofile);
    await expect(nofileRow.getByText("Terminé", { exact: true })).toBeVisible();
    await expect(page.locator(`a[href="${downloadPath(ids.nofile)}"]`)).toHaveCount(0);
  });

  test("un autre utilisateur reçoit 403 et n'enregistre aucune activité", async ({ page }) => {
    await loginAs(page, "cm");

    const res = await page.request.get(downloadPath(ids.available), { maxRedirects: 0 });
    expect(res.status()).toBe(403);

    const job = await prismaTest.captionJob.findUniqueOrThrow({ where: { id: ids.available } });
    expect(job.lastAccessedAt).toBeNull();
  });

  test("sans session : 401, pas de redirection vers /login", async ({ request }) => {
    // `request` n'a aucune session : proxy.ts répond 401 aux appels /api.
    const res = await request.get(downloadPath(ids.available), { maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect(res.headers()["location"]).toBeUndefined();
  });
});
