/**
 * Lien de téléchargement des données d'un client — /admin/clients/[id] → /export/[token].
 *
 * Environnement e2e = stockage local : les fichiers des médias vivent sous
 * public/uploads/<id>.<ext> (derrière asset.url, pas r2Key) et sont servis
 * same-origin ; les URLs « signées » sont donc des chemins /uploads/….
 *
 * Fixtures dédiées (suffixe RUN) : un client à deux comptes (Sarah, Paul), un
 * compte d'un autre client (intrus), une bibliothèque vidéo, une de sons, une de
 * données, deux publications. Couvre les règles de périmètre, l'anti-IDOR des
 * URLs, la révocation, et les routes publiques rouvertes dans proxy.ts.
 */

import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { randomBytes, randomUUID } from "crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { loginAs, TEST_USERS } from "./fixtures/auth";

const prismaTest = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL ?? "postgresql://toolbox:toolbox@localhost:5433/toolbox_test",
    },
  },
});

const RUN = randomUUID().slice(0, 6);
const UPLOADS = path.join(__dirname, "..", "public", "uploads");

const ids = {
  client: `e2e-export-client-${RUN}`,
  otherClient: `e2e-export-other-${RUN}`,
  sarah: `e2e-export-sarah-${RUN}`,
  paul: `e2e-export-paul-${RUN}`,
  intrus: `e2e-export-intrus-${RUN}`,
  videoLib: `e2e-export-vlib-${RUN}`,
  audioLib: `e2e-export-alib-${RUN}`,
  dataLib: `e2e-export-dlib-${RUN}`,
  sarahRush: `e2eexpa1${RUN}`,
  paulRush: `e2eexpa2${RUN}`,
  intrusRush: `e2eexpa3${RUN}`,
  globalVideo: `e2eexpa4${RUN}`,
  generated: `e2eexpa5${RUN}`,
  ambiance: `e2eexpm1${RUN}`,
  paulVoice: `e2eexpm2${RUN}`,
  slotPublished: `e2e-export-slot1-${RUN}`,
  slotNoVideo: `e2e-export-slot2-${RUN}`,
};

const names = {
  client: `E2E Export ${RUN}`,
  sarah: `Sarah ${RUN}`,
  paul: `Paul ${RUN}`,
  videoLib: `Behind ${RUN}`,
  audioLib: `Musiques ${RUN}`,
  dataLib: `Chiffres ${RUN}`,
};

/** Octets distincts par fichier : la taille sert de preuve de complétude. */
function bytes(size: number): Buffer {
  return Buffer.alloc(size, size % 251);
}

const FILES = {
  sarahRush: bytes(2048),
  paulRush: bytes(3072),
  intrusRush: bytes(1024),
  globalVideo: bytes(512),
  generated: bytes(640),
  ambiance: bytes(1536),
  paulVoice: bytes(768),
  version: bytes(4096),
};

const versionKey = `publications/${ids.slotPublished}/versions/v0-e2e.mp4`;
const writtenFiles: string[] = [];

function writeUpload(relative: string, content: Buffer) {
  const full = path.join(UPLOADS, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  writtenFiles.push(full);
}

async function createAsset(input: {
  id: string;
  libraryId: string;
  filename: string;
  ext: string;
  file: Buffer;
  accounts: string[];
  setTag?: string;
  source?: string;
}) {
  const kind = input.ext === "mp3" ? "audio" : "videos";
  writeUpload(`${input.id}.${input.ext}`, input.file);
  await prismaTest.mediaAsset.create({
    data: {
      id: input.id,
      libraryId: input.libraryId,
      filename: input.filename,
      r2Key: `content-library/${kind}/${input.id}.${input.ext}`,
      url: `/uploads/${input.id}.${input.ext}`,
      mimeType: input.ext === "mp3" ? "audio/mpeg" : "video/quicktime",
      setTag: input.setTag ?? null,
      source: input.source ?? null,
      accesses: { create: input.accounts.map((accountId) => ({ accountId })) },
    },
  });
}

async function seedFixtures() {
  const admin = await prismaTest.user.findUniqueOrThrow({ where: { username: TEST_USERS.admin.username } });

  await prismaTest.client.create({ data: { id: ids.client, name: names.client } });
  await prismaTest.client.create({ data: { id: ids.otherClient, name: `Autre ${RUN}` } });
  await prismaTest.instagramAccount.createMany({
    data: [
      { id: ids.sarah, name: names.sarah, handle: `sarah_${RUN}`, clientId: ids.client },
      { id: ids.paul, name: names.paul, handle: `paul_${RUN}`, clientId: ids.client },
      { id: ids.intrus, name: `Intrus ${RUN}`, handle: `intrus_${RUN}`, clientId: ids.otherClient },
    ],
  });

  await prismaTest.mediaLibrary.create({ data: { id: ids.videoLib, name: names.videoLib, type: "video" } });
  await prismaTest.mediaLibrary.create({ data: { id: ids.audioLib, name: names.audioLib, type: "audio" } });

  await createAsset({
    id: ids.sarahRush, libraryId: ids.videoLib, filename: "sarah-rush.mov", ext: "mov",
    file: FILES.sarahRush, accounts: [ids.sarah], setTag: "Cuisine",
  });
  await createAsset({
    id: ids.paulRush, libraryId: ids.videoLib, filename: "paul-rush.mov", ext: "mov",
    file: FILES.paulRush, accounts: [ids.paul],
  });
  // Réservé au compte d'un AUTRE client : ne doit jamais sortir.
  await createAsset({
    id: ids.intrusRush, libraryId: ids.videoLib, filename: "intrus-rush.mov", ext: "mov",
    file: FILES.intrusRush, accounts: [ids.intrus],
  });
  // Vidéo commune : jamais exportée (stock partagé).
  await createAsset({
    id: ids.globalVideo, libraryId: ids.videoLib, filename: "stock.mov", ext: "mov",
    file: FILES.globalVideo, accounts: [],
  });
  // Auto-save : exclu, même réservé.
  await createAsset({
    id: ids.generated, libraryId: ids.videoLib, filename: "mission.mov", ext: "mov",
    file: FILES.generated, accounts: [ids.sarah], source: "generated",
  });
  // Son commun → « Commun » ; son réservé à Paul → dossier de Paul.
  await createAsset({
    id: ids.ambiance, libraryId: ids.audioLib, filename: "ambiance.mp3", ext: "mp3",
    file: FILES.ambiance, accounts: [],
  });
  await createAsset({
    id: ids.paulVoice, libraryId: ids.audioLib, filename: "voix-off.mp3", ext: "mp3",
    file: FILES.paulVoice, accounts: [ids.paul],
  });

  await prismaTest.dataLibrary.create({
    data: {
      id: ids.dataLib,
      name: names.dataLib,
      templateType: "RPI",
      fieldsSchema: JSON.stringify([
        { key: "quartier", label: "Quartier", type: "text" },
        { key: "prix_m2", label: "Prix au m²", type: "number" },
      ]),
      entries: {
        create: [
          { fields: JSON.stringify({ quartier: "Croix-Rousse", prix_m2: 5100 }), setTag: "lyon" },
          { fields: JSON.stringify({ quartier: "Confluence", prix_m2: 6200 }), setTag: "lyon" },
          {
            fields: JSON.stringify({ quartier: "Bellecour", prix_m2: 7400 }),
            accesses: { create: [{ accountId: ids.sarah }] },
          },
        ],
      },
    },
  });

  // Publication publiée avec une version de montage, et une publiée sans vidéo.
  writeUpload(versionKey, FILES.version);
  await prismaTest.publicationSlot.create({
    data: {
      id: ids.slotPublished,
      accountId: ids.sarah,
      status: "PUBLISHED",
      title: `Visite T3 ${RUN}`,
      publishedAt: new Date("2026-09-14T08:00:00Z"),
    },
  });
  const version = await prismaTest.publicationVersion.create({
    data: {
      slotId: ids.slotPublished,
      versionNumber: 1,
      r2Key: versionKey,
      fileUrl: `/uploads/${versionKey}`,
      fileName: "Montage final.mp4",
      fileSizeBytes: FILES.version.length,
      mimeType: "video/mp4",
      uploadedByUserId: admin.id,
    },
  });
  await prismaTest.publicationSlot.update({
    where: { id: ids.slotPublished },
    data: { currentVersionId: version.id },
  });
  await prismaTest.publicationSlot.create({
    data: {
      id: ids.slotNoVideo,
      accountId: ids.paul,
      status: "PUBLISHED",
      title: `Sans vidéo ${RUN}`,
      publishedAt: new Date("2026-09-15T08:00:00Z"),
    },
  });
}

async function cleanupFixtures() {
  await prismaTest.clientExportLink.deleteMany({ where: { clientId: ids.client } });
  // Les slots tombent avec leurs comptes (cascade), les versions avec les slots.
  await prismaTest.instagramAccount.deleteMany({ where: { id: { in: [ids.sarah, ids.paul, ids.intrus] } } });
  await prismaTest.mediaLibrary.deleteMany({ where: { id: { in: [ids.videoLib, ids.audioLib] } } });
  await prismaTest.dataLibrary.deleteMany({ where: { id: ids.dataLib } });
  await prismaTest.client.deleteMany({ where: { id: { in: [ids.client, ids.otherClient] } } });
  for (const file of writtenFiles) rmSync(file, { force: true });
  rmSync(path.join(UPLOADS, "publications", ids.slotPublished), { recursive: true, force: true });
}

/** Crée un lien par l'API admin (session admin du navigateur). */
async function createLinkAsAdmin(
  request: APIRequestContext,
  body: Partial<{
    accountIds: string[];
    mediaLibraryIds: string[];
    dataLibraryIds: string[];
    includePublications: boolean;
  }> = {},
): Promise<{ rawToken: string; linkId: string }> {
  const res = await request.post(`/api/admin/clients/${ids.client}/export-links`, {
    data: {
      expiresInDays: 7,
      accountIds: [ids.sarah, ids.paul],
      mediaLibraryIds: [ids.videoLib, ids.audioLib],
      dataLibraryIds: [ids.dataLib],
      includePublications: true,
      ...body,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const json = (await res.json()) as { rawToken: string; link: { id: string } };
  return { rawToken: json.rawToken, linkId: json.link.id };
}

type Manifest = {
  rootName: string;
  files: Array<{ ref: string; kind: string; path: string[]; size: number | null }>;
  skipped: Array<{ label: string; reason: string }>;
  totals: { files: number; bytes: number; accounts: number };
};

test.describe("Lien de téléchargement client", () => {
  test.beforeAll(async () => {
    await cleanupFixtures();
    await seedFixtures();
  });

  test.afterAll(async () => {
    await cleanupFixtures();
    await prismaTest.$disconnect();
  });

  test("le manifeste suit les règles de périmètre", async ({ page, request }) => {
    await loginAs(page, "admin");
    const { rawToken } = await createLinkAsAdmin(page.request);

    // Appel anonyme : `request` n'a pas la session de `page`.
    const res = await request.get(`/api/export/${rawToken}/manifest`);
    expect(res.status()).toBe(200);
    const manifest = (await res.json()) as Manifest;

    const paths = manifest.files.map((f) => f.path.join("/")).sort();
    const root = manifest.rootName;
    expect(root).toBe(names.client);
    expect(paths).toEqual(
      [
        `${root}/${names.sarah}/${names.videoLib}/Cuisine/sarah-rush.mov`,
        `${root}/${names.paul}/${names.videoLib}/paul-rush.mov`,
        `${root}/${names.paul}/${names.audioLib}/voix-off.mp3`,
        `${root}/Commun/${names.audioLib}/ambiance.mp3`,
        `${root}/Commun/${names.dataLib}/${names.dataLib}.xlsx`,
        `${root}/${names.sarah}/${names.dataLib}/${names.dataLib}.xlsx`,
        `${root}/${names.sarah}/Publications/2026-09-14 - Visite T3 ${RUN}.mp4`,
      ].sort(),
    );

    // Jamais : le rush d'un autre client, la vidéo commune, l'auto-save.
    const all = paths.join("\n");
    expect(all).not.toContain("intrus-rush");
    expect(all).not.toContain("stock.mov");
    expect(all).not.toContain("mission");

    const bySuffix = (suffix: string) => manifest.files.find((f) => f.path.join("/").endsWith(suffix));
    expect(bySuffix("sarah-rush.mov")?.size).toBe(FILES.sarahRush.length);
    expect(bySuffix("ambiance.mp3")?.size).toBe(FILES.ambiance.length);
    expect(bySuffix(`Visite T3 ${RUN}.mp4`)?.size).toBe(FILES.version.length);
    expect(bySuffix(".xlsx")?.size).toBeNull();

    expect(manifest.skipped).toEqual([expect.objectContaining({ reason: "no_video" })]);
    expect(manifest.totals.accounts).toBe(2); // Sarah et Paul — « Commun » n'est pas un compte
  });

  test("seules les refs du manifeste reçoivent une URL (anti-IDOR)", async ({ page, request }) => {
    await loginAs(page, "admin");
    const { rawToken } = await createLinkAsAdmin(page.request);
    const manifest = (await (await request.get(`/api/export/${rawToken}/manifest`)).json()) as Manifest;
    const sarahRush = manifest.files.find((f) => f.path.at(-1) === "sarah-rush.mov")!;

    const forged = [
      `m.${ids.intrusRush}.${ids.intrus}`,
      `m.${ids.intrusRush}.${ids.sarah}`,
      `m.${ids.globalVideo}.${ids.sarah}`,
      `m.${ids.generated}.${ids.sarah}`,
      `p.${ids.slotNoVideo}`,
    ];
    const res = await request.post(`/api/export/${rawToken}/urls`, { data: { refs: [sarahRush.ref, ...forged] } });
    expect(res.status()).toBe(200);
    const { urls, missing } = (await res.json()) as { urls: Record<string, string>; missing: string[] };

    expect(Object.keys(urls)).toEqual([sarahRush.ref]);
    expect(missing.sort()).toEqual([...forged].sort());

    const file = await request.get(urls[sarahRush.ref]);
    expect(file.status()).toBe(200);
    expect((await file.body()).length).toBe(FILES.sarahRush.length);
  });

  test("les fiches partent en .xlsx, communes et réservées séparées", async ({ page, request }) => {
    await loginAs(page, "admin");
    const { rawToken } = await createLinkAsAdmin(page.request);
    const manifest = (await (await request.get(`/api/export/${rawToken}/manifest`)).json()) as Manifest;
    const sheets = manifest.files.filter((f) => f.kind === "data");
    const { urls } = (await (
      await request.post(`/api/export/${rawToken}/urls`, { data: { refs: sheets.map((s) => s.ref) } })
    ).json()) as { urls: Record<string, string> };

    const rowsOf = async (ref: string) => {
      const res = await request.get(urls[ref]);
      expect(res.status()).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load((await res.body()) as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];
      const rows: string[][] = [];
      sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map((v) => String(v ?? ""))));
      return rows;
    };

    const common = sheets.find((s) => s.path[1] === "Commun")!;
    const sarah = sheets.find((s) => s.path[1] === names.sarah)!;
    const commonRows = await rowsOf(common.ref);
    expect(commonRows[0]).toEqual(["Dossier", "Quartier", "Prix au m²"]);
    expect(commonRows.slice(1).map((r) => r[1]).sort()).toEqual(["Confluence", "Croix-Rousse"]);
    const sarahRows = await rowsOf(sarah.ref);
    expect(sarahRows.slice(1).map((r) => r[1])).toEqual(["Bellecour"]);
  });

  test("l'activité du client remonte côté admin", async ({ page, request }) => {
    await loginAs(page, "admin");
    const { rawToken, linkId } = await createLinkAsAdmin(page.request);
    await request.get(`/api/export/${rawToken}/manifest`);
    const report = { files: 7, bytes: 12_288, skipped: 0, failed: 0, missing: 0 };
    expect((await request.post(`/api/export/${rawToken}/events`, { data: { type: "started", ...report } })).status()).toBe(204);
    expect((await request.post(`/api/export/${rawToken}/events`, { data: { type: "completed", ...report } })).status()).toBe(204);

    const list = (await (await page.request.get(`/api/admin/clients/${ids.client}/export-links`)).json()) as {
      links: Array<{ id: string; startCount: number; firstOpenedAt: string | null; downloadCompletedAt: string | null; lastReport: unknown }>;
    };
    const link = list.links.find((l) => l.id === linkId)!;
    expect(link.startCount).toBe(1);
    expect(link.firstOpenedAt).not.toBeNull();
    expect(link.downloadCompletedAt).not.toBeNull();
    expect(link.lastReport).toEqual(report);
  });

  test("un lien révoqué ne sert plus rien", async ({ page, request }) => {
    await loginAs(page, "admin");
    const { rawToken, linkId } = await createLinkAsAdmin(page.request);
    expect((await request.get(`/api/export/${rawToken}/manifest`)).status()).toBe(200);

    const revoke = await page.request.patch(`/api/admin/clients/${ids.client}/export-links/${linkId}`, {
      data: { action: "revoke" },
    });
    expect(revoke.status()).toBe(200);

    expect((await request.get(`/api/export/${rawToken}/manifest`)).status()).toBe(404);
    expect((await request.post(`/api/export/${rawToken}/urls`, { data: { refs: ["x"] } })).status()).toBe(404);
  });

  test("un compte d'un autre client est refusé à la création", async ({ page }) => {
    await loginAs(page, "admin");
    const res = await page.request.post(`/api/admin/clients/${ids.client}/export-links`, {
      data: {
        expiresInDays: 7,
        accountIds: [ids.sarah, ids.intrus],
        mediaLibraryIds: [ids.videoLib],
        dataLibraryIds: [],
        includePublications: false,
      },
    });
    expect(res.status()).toBe(400);
  });

  test("l'admin crée un lien depuis la fiche client, puis le révoque", async ({ page, request }) => {
    await loginAs(page, "admin");
    await page.goto(`/admin/clients/${ids.client}`);
    await page.getByRole("button", { name: "Lien de téléchargement" }).click();

    const drawer = page.getByRole("dialog");
    // L'aperçu des volumes est chargé : les bibliothèques du client apparaissent.
    await expect(drawer.getByText(names.videoLib).first()).toBeVisible({ timeout: 30_000 });
    await expect(drawer.getByRole("checkbox", { name: "Vidéos publiées" })).toBeVisible();
    const created = page.waitForResponse(
      (r) => r.url().endsWith(`/api/admin/clients/${ids.client}/export-links`) && r.request().method() === "POST",
    );
    await drawer.getByRole("button", { name: "Créer le lien" }).click();
    const linkId = ((await (await created).json()) as { link: { id: string } }).link.id;

    const share = drawer.getByRole("textbox", { name: "Lien de téléchargement" });
    await expect(share).toHaveValue(/\/export\/[0-9a-f]{64}$/);
    const rawToken = (await share.inputValue()).split("/export/")[1];
    await drawer.getByRole("button", { name: "Terminé" }).click();

    // Le lien créé par le tiroir sert bien le périmètre attendu.
    const manifest = (await (await request.get(`/api/export/${rawToken}/manifest`)).json()) as Manifest;
    expect(manifest.files.some((f) => f.path.at(-1) === "sarah-rush.mov")).toBe(true);

    // La liste est triée du plus récent au plus ancien : le premier menu est celui du lien créé.
    await expect(page.getByText("Liens de téléchargement")).toBeVisible();
    await page.getByRole("button", { name: "Actions du lien" }).first().click();
    await page.getByRole("menuitem", { name: "Révoquer" }).click();
    const revoked = page.waitForResponse(
      (r) => r.url().includes("/export-links/") && r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Révoquer", exact: true }).last().click();
    const revokeResponse = await revoked;
    expect(revokeResponse.status()).toBe(200);
    expect(revokeResponse.url()).toContain(`/export-links/${linkId}`);

    expect((await request.get(`/api/export/${rawToken}/manifest`)).status()).toBe(404);
  });

  test("la page publique écrit l'arborescence, puis reprend sans retélécharger", async ({ page, browser }) => {
    await loginAs(page, "admin");
    const { rawToken, linkId } = await createLinkAsAdmin(page.request);
    const manifest = (await (await page.request.get(`/api/export/${rawToken}/manifest`)).json()) as Manifest;

    // Visiteur sans compte. Le vrai sélecteur de dossier exige un geste et un
    // dialogue natif : on le remplace par le stockage privé du navigateur
    // (OPFS), qui fournit de VRAIS handles File System Access au même moteur.
    const context = await browser.newContext();
    await context.addInitScript(() => {
      (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker =
        () => navigator.storage.getDirectory();
    });
    const visitor = await context.newPage();
    try {
      await visitor.goto(`/export/${rawToken}`);
      await visitor.getByRole("button", { name: "Choisir un dossier et télécharger" }).click();
      await expect(visitor.getByText("Téléchargement terminé")).toBeVisible({ timeout: 60_000 });

      const readTree = () =>
        visitor.evaluate(async () => {
          const out: Record<string, number> = {};
          type Dir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };
          const walk = async (dir: Dir, prefix: string) => {
            for await (const [name, handle] of dir.entries()) {
              if (handle.kind === "directory") await walk(handle as Dir, `${prefix}${name}/`);
              else out[`${prefix}${name}`] = (await (handle as FileSystemFileHandle).getFile()).size;
            }
          };
          await walk((await navigator.storage.getDirectory()) as Dir, "");
          return out;
        });

      const tree = await readTree();
      // Chaque fichier du manifeste est là, à la bonne taille ; rien de plus (pas de .crswap ni de fichier vide).
      expect(Object.keys(tree).sort()).toEqual(manifest.files.map((f) => f.path.join("/")).sort());
      for (const file of manifest.files) {
        const key = file.path.join("/");
        if (file.size !== null) expect(tree[key], key).toBe(file.size);
        else expect(tree[key], key).toBeGreaterThan(0);
      }

      // Reprise : après rechargement, le dossier mémorisé est proposé et rien n'est retéléchargé.
      await visitor.reload();
      await visitor.getByRole("button", { name: /Reprendre dans/ }).click();
      await expect(visitor.getByText("Téléchargement terminé")).toBeVisible({ timeout: 60_000 });
      expect(await readTree()).toEqual(tree);
    } finally {
      await context.close();
    }

    const list = (await (await page.request.get(`/api/admin/clients/${ids.client}/export-links`)).json()) as {
      links: Array<{ id: string; startCount: number; downloadCompletedAt: string | null }>;
    };
    const link = list.links.find((l) => l.id === linkId)!;
    expect(link.startCount).toBe(2);
    expect(link.downloadCompletedAt).not.toBeNull();
  });

  test("les routes admin restent fermées aux visiteurs et aux non-admins", async ({ page, request }) => {
    expect((await request.get(`/api/admin/clients/${ids.client}/export-links`)).status()).toBe(401);
    await loginAs(page, "monteur");
    expect((await page.request.get(`/api/admin/clients/${ids.client}/export-preview`)).status()).toBe(403);
  });
});

test.describe("Routes publiques rouvertes (proxy.ts)", () => {
  const fakeToken = () => randomBytes(32).toString("hex");

  test("/export/<jeton inconnu> répond 404 sans renvoyer vers /login", async ({ request }) => {
    const res = await request.get(`/export/${fakeToken()}`, { maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });

  test("/validate et /data-fill sont joignables sans session", async ({ request }) => {
    const validate = await request.get(`/validate/${fakeToken()}`, { maxRedirects: 0 });
    expect(validate.status()).not.toBe(307);
    expect(validate.headers()["location"] ?? "").not.toContain("/login");

    const dataFill = await request.get(`/api/data-fill/${fakeToken()}`);
    expect(dataFill.status()).toBe(404);
    expect(await dataFill.json()).toEqual({ error: "Lien invalide ou révoqué" });
  });

  test("les crons atteignent leur handler (secret vérifié par la route)", async ({ request }) => {
    const res = await request.post("/api/cron/r2-cleanup");
    const body = (await res.json()) as { error?: string };
    // 401 « Unauthorized » du handler, ou 503 si CRON_SECRET n'est pas configuré —
    // jamais le 401 « Non authentifié » du proxy.
    expect(body.error).not.toBe("Non authentifié");
  });
});
