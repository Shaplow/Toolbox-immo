/**
 * Rétention des vidéos sous-titrées de l'Atelier — les deux filtres Prisma face à un vrai
 * PostgreSQL.
 *
 * Les tests unitaires (lib/captions/__tests__, services/captions/__tests__) figent la FORME
 * de `purgeCandidateWhere` / `claimGuardWhere` et testent la règle JS `isPurgeCandidate` ;
 * aucun ne dit ce que PostgreSQL en fait : NOT sur une colonne NULL, ILIKE, filtre de
 * relation inverse (`activeForSlot: { is: null }`), bornes strictes des 60 jours, UPDATE …
 * WHERE atomique. Ici : des lignes seedées sur `toolbox_test`, la vraie requête, et
 * l'ensemble sélectionné comparé à l'ensemble attendu, ligne par ligne. Une erreur de ces
 * filtres supprime la vidéo d'une publication.
 *
 * Pas de navigateur, de session ni de R2 : seulement Prisma (la config Playwright démarre
 * quand même le serveur de dev). Fixtures dédiées à l'utilisateur admin (suffixe RUN),
 * supprimées en fin de spec.
 *
 * Écart voulu entre SQL et JS : le SQL exclut tout `auto-….json`, un peu plus que la règle
 * JS (`auto-<id>.json`, `auto-transcription-<id>.json`), donc `auto-ma-visite.json` n'est
 * jamais purgé. L'écart inverse (une ligne que le SQL retient et que le JS refuse) est le
 * filet `skipped.unsafeKey` du service : voir le dernier test de « purgeCandidateWhere ».
 */

import { randomUUID } from "crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  captionRetentionCutoff,
  claimGuardWhere,
  isPurgeCandidate,
  purgeCandidateWhere,
} from "../src/lib/captions/outputRetention";
import { TEST_USERS } from "./fixtures/auth";

const prismaTest = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL ?? "postgresql://toolbox:toolbox@localhost:5433/toolbox_test",
    },
  },
});

const RUN = randomUUID().slice(0, 6);
const ID_PREFIX = "e2e-capsql-";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Instant de référence : la borne des 60 jours en découle, à la milliseconde (colonnes timestamp(3)). */
const NOW = new Date();
const CUTOFF = captionRetentionCutoff(NOW);
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const justBefore = (date: Date) => new Date(date.getTime() - 1);

/** Slot du seed (scripts/seed-test-db.ts) : un job qui lui est lié ne doit jamais être purgé. */
const SEEDED_SLOT_ID = "test-slot-orphan";
/** Slot dédié dont le sous-titre actif est le job « sous-titre-actif » (aucun slot du seed n'en porte). */
const ACTIVE_SLOT_ID = `${ID_PREFIX}slot-${RUN}`;

let userId = "";
let keySeq = 0;

const idOf = (name: string) => `${ID_PREFIX}${name}-${RUN}`;
/** Nom lisible d'un id de fixture : un diff d'ensemble de noms se lit mieux qu'un diff d'ids. */
const nameOf = (id: string) => id.slice(ID_PREFIX.length, id.length - RUN.length - 1);

/** Clé d'une vidéo de l'Atelier, unique par ligne. */
function atelierKey(kind: "full" | "preview" = "full"): string {
  return `outputs/captions/${userId}/${1_760_000_000_000 + ++keySeq}/${kind}.mp4`;
}

type Overrides = Partial<Omit<Prisma.CaptionJobCreateManyInput, "id" | "userId">>;
type RowData = Prisma.CaptionJobCreateManyInput & { id: string };

/** Par défaut : une vidéo de l'Atelier, jamais téléchargée, vieille de 90 jours, donc purgeable. */
function rowData(id: string, overrides: Overrides): RowData {
  return {
    id,
    userId,
    status: "COMPLETED",
    inputUrl: `visite-${RUN}.mp4`,
    srtFilename: "captions.json",
    srtContent: "[]",
    outputKey: atelierKey(),
    outputUrl: `https://cdn.toolboximmo.com/e2e/${id}.mp4`,
    createdAt: daysAgo(90),
    ...overrides,
  };
}

/** Une ligne à part, créée par le test lui-même (supprimée d'abord : un rejeu du test ne doit pas heurter la clé primaire). */
async function seedRow(name: string, overrides: Overrides = {}) {
  const data = rowData(idOf(name), overrides);
  await prismaTest.captionJob.deleteMany({ where: { id: data.id } });
  await prismaTest.captionJob.createMany({ data: [data] });
  return { id: data.id, outputKey: data.outputKey ?? null };
}

/** Ce qu'un passage réel supprimerait : le SQL doit retenir exactement ces lignes. */
function purgedCases(): Record<string, Overrides> {
  return {
    // Cas nominal, puis les variantes de clé.
    "rendu-complet": {},
    apercu: { outputKey: atelierKey("preview") },
    // Avant le 20/04/2026 : pas de segment utilisateur dans la clé.
    "cle-sans-utilisateur": { outputKey: `outputs/captions/${1_760_000_000_000 + ++keySeq}/full.mp4` },
    // NOT sur une colonne NULL est NULL : seule la branche explicite garde ces lignes.
    "sans-nom-de-sous-titres": { srtFilename: null },
    // Un rendu en échec a une clé (posée à la création) et le plus souvent aucun fichier : purgeable comme les autres.
    echec: { status: "FAILED" },
    // Commence par « auto » mais pas par « auto- » : un fichier de l'utilisateur, avec ou sans .json.
    "fichier-automne": { srtFilename: "automne.srt" },
    "fichier-automne-json": { srtFilename: "automne.json" },
    // « auto- » sans « .json » : le pipeline auto ne produit que des .json.
    "auto-sans-json": { srtFilename: "auto-visite.srt" },
    // L'activité est le dernier téléchargement, pas la génération : ancien, il ne protège plus.
    "ancien-telechargement": { createdAt: daysAgo(100), lastAccessedAt: daysAgo(70) },
    // Bornes strictes, côté génération puis côté téléchargement : une milliseconde avant, c'est purgeable.
    "creation-juste-avant-la-borne": { createdAt: justBefore(CUTOFF) },
    "telechargement-juste-avant-la-borne": { createdAt: daysAgo(100), lastAccessedAt: justBefore(CUTOFF) },
  };
}

/** Ce qui ne doit jamais sortir du SQL, avec la raison en commentaire. */
function keptCases(): Record<string, Overrides> {
  return {
    publication: { slotId: SEEDED_SLOT_ID },
    // slotId nul mais sous-titre actif d'un slot (lien posé dans seedFixtures).
    "sous-titre-actif": {},
    "auto-transcription": { srtFilename: "auto-transcription-x.json" },
    "auto-majuscules": { srtFilename: "AUTO-x.json" },
    // Écart voulu : le JS le tient pour un fichier ordinaire, le SQL le garde par prudence.
    "auto-nom-compose": { srtFilename: "auto-ma-visite.json" },
    "cle-auto": { srtFilename: null, outputKey: `outputs/captions/${userId}/${1_760_000_000_000 + ++keySeq}/auto.mp4` },
    "cle-hors-prefixe": { outputKey: `publications/${SEEDED_SLOT_ID}/versions/v0-${RUN}.mp4` },
    "sans-cle": { outputKey: null, outputUrl: `/api/captions/outputs/temp/${RUN}/full.mp4` },
    recent: { createdAt: daysAgo(10) },
    "telechargement-recent": { createdAt: daysAgo(100), lastAccessedAt: daysAgo(10) },
    // Exactement 60 jours : la borne est stricte.
    "creation-a-la-borne": { createdAt: CUTOFF },
    "telechargement-a-la-borne": { createdAt: daysAgo(100), lastAccessedAt: CUTOFF },
    // Déjà réclamée par un passage précédent (suppression R2 peut-être en attente).
    "deja-expire": { outputExpiredAt: daysAgo(1) },
    "en-cours": { status: "PROCESSING" },
    "en-file": { status: "QUEUED" },
  };
}

let purged: Record<string, Overrides> = {};
let kept: Record<string, Overrides> = {};
let fixtureIds: string[] = [];

async function cleanupFixtures() {
  // Les jobs d'abord : le slot dédié pointe l'un d'eux (FK SET NULL, l'ordre est sans risque).
  await prismaTest.captionJob.deleteMany({ where: { id: { startsWith: ID_PREFIX } } });
  await prismaTest.publicationSlot.deleteMany({ where: { id: { startsWith: ID_PREFIX } } });
}

async function seedFixtures() {
  const admin = await prismaTest.user.findUniqueOrThrow({ where: { email: TEST_USERS.admin.email } });
  userId = admin.id;
  // Seed requis : `npm run test:db:seed`.
  await prismaTest.publicationSlot.findUniqueOrThrow({ where: { id: SEEDED_SLOT_ID } });

  purged = purgedCases();
  kept = keptCases();
  const all = { ...purged, ...kept };
  fixtureIds = Object.keys(all).map(idOf);
  await prismaTest.captionJob.createMany({
    data: Object.entries(all).map(([name, overrides]) => rowData(idOf(name), overrides)),
  });

  await prismaTest.publicationSlot.create({
    data: { id: ACTIVE_SLOT_ID, title: `Slot rétention ${RUN}`, activeCaptionJobId: idOf("sous-titre-actif") },
  });
}

/** Les colonnes que lit `isPurgeCandidate` (type `RetentionJob`). */
const RETENTION_SELECT = {
  id: true,
  status: true,
  slotId: true,
  activeForSlot: { select: { id: true } },
  srtFilename: true,
  outputKey: true,
  outputExpiredAt: true,
  lastAccessedAt: true,
  createdAt: true,
} as const;

/** Le SQL de lecture de la purge, restreint à `ids` pour ignorer le reste de la base de test. */
function selectCandidates(ids: string[]) {
  return prismaTest.captionJob.findMany({
    where: { AND: [purgeCandidateWhere(CUTOFF), { id: { in: ids } }] },
    select: RETENTION_SELECT,
  });
}

test.describe("Rétention des vidéos sous-titrées : filtres SQL", () => {
  test.beforeAll(async () => {
    await cleanupFixtures();
    await seedFixtures();
  });

  test.afterAll(async () => {
    await cleanupFixtures();
    await prismaTest.$disconnect();
  });

  test.describe("purgeCandidateWhere", () => {
    test("retient exactement les vidéos expirables, et rien d'autre", async () => {
      // Garde-fou du test : une fixture non semée fausserait l'ensemble comparé.
      expect(await prismaTest.captionJob.count({ where: { id: { in: fixtureIds } } })).toBe(fixtureIds.length);

      const selected = await selectCandidates(fixtureIds);

      expect(selected.map((row) => nameOf(row.id)).sort()).toEqual(Object.keys(purged).sort());
    });

    test("tout ce que le SQL retient repasse par isPurgeCandidate", async () => {
      const selected = await selectCandidates(fixtureIds);

      expect(selected.length).toBeGreaterThan(0);
      for (const row of selected) {
        expect(isPurgeCandidate(row, NOW), `${nameOf(row.id)} remonte du SQL mais isPurgeCandidate la refuse`).toBe(true);
      }
    });

    test("une clé de forme inconnue sous outputs/captions/ passe le SQL mais pas isPurgeCandidate (filet JS)", async () => {
      const { id } = await seedRow("cle-de-forme-inconnue", {
        outputKey: `outputs/captions/${userId}/pas-un-horodatage/full.mp4`,
      });

      const selected = await selectCandidates([id]);

      expect(selected.map((row) => row.id)).toEqual([id]);
      expect(isPurgeCandidate(selected[0], NOW)).toBe(false);
    });
  });

  test.describe("claimGuardWhere", () => {
    /** La réclamation du service : la garde, plus la clé lue (`{ ...claimGuardWhere(id, cutoff), outputKey }`). */
    function claim(id: string, extra: Prisma.CaptionJobWhereInput = {}) {
      return prismaTest.captionJob.updateMany({
        where: { ...claimGuardWhere(id, CUTOFF), ...extra },
        data: { outputExpiredAt: NOW, outputUrl: null },
      });
    }

    test("réclame une vidéo expirable : une seule ligne, marquée expirée, clé encore là", async () => {
      const { id, outputKey } = await seedRow("claim-ok");
      expect(outputKey).not.toBeNull();

      expect((await claim(id, { outputKey })).count).toBe(1);

      const row = await prismaTest.captionJob.findUniqueOrThrow({ where: { id } });
      expect(row.outputExpiredAt).toEqual(NOW);
      expect(row.outputUrl).toBeNull();
      // La clé ne part qu'après la suppression R2 : tant qu'elle est là, la ligne est « en attente ».
      expect(row.outputKey).toBe(outputKey);

      // Un second passage ne réclame plus rien.
      expect((await claim(id, { outputKey })).count).toBe(0);
    });

    test("réclame aussi un rendu en échec (FAILED) : la lecture le retient, la garde ne doit pas le refuser", async () => {
      const { id, outputKey } = await seedRow("claim-echec", { status: "FAILED" });
      expect((await selectCandidates([id])).map((row) => row.id)).toEqual([id]);

      expect((await claim(id, { outputKey })).count).toBe(1);

      const row = await prismaTest.captionJob.findUniqueOrThrow({ where: { id } });
      expect(row.outputExpiredAt).toEqual(NOW);
    });

    test("un téléchargement arrivé entre la lecture et la réclamation gagne", async () => {
      const { id, outputKey } = await seedRow("claim-course");
      // Lecture de la purge : la ligne est candidate.
      expect((await selectCandidates([id])).map((row) => row.id)).toEqual([id]);

      // Téléchargement par l'app (GET /api/render/captions/[id]/download) avant l'écriture.
      await prismaTest.captionJob.update({ where: { id }, data: { lastAccessedAt: new Date() } });

      expect((await claim(id, { outputKey })).count).toBe(0);
      const row = await prismaTest.captionJob.findUniqueOrThrow({ where: { id } });
      expect(row.outputExpiredAt).toBeNull();
      expect(row.outputUrl).not.toBeNull();
      // Et la lecture suivante ne la retient plus.
      expect(await selectCandidates([id])).toEqual([]);
    });

    test("la clé lue fait partie de la garde : une autre clé ne réclame rien", async () => {
      const { id } = await seedRow("claim-autre-cle");

      expect((await claim(id, { outputKey: atelierKey() })).count).toBe(0);

      const row = await prismaTest.captionJob.findUniqueOrThrow({ where: { id } });
      expect(row.outputExpiredAt).toBeNull();
    });

    const refused: Array<{ label: string; name: string; overrides: Overrides }> = [
      { label: "téléchargée récemment", name: "claim-telechargee", overrides: { lastAccessedAt: daysAgo(1) } },
      { label: "déjà expirée", name: "claim-deja-expiree", overrides: { outputExpiredAt: daysAgo(1) } },
      { label: "liée à une publication", name: "claim-publication", overrides: { slotId: SEEDED_SLOT_ID } },
      { label: "en cours (PROCESSING)", name: "claim-en-cours", overrides: { status: "PROCESSING" } },
      { label: "en file (QUEUED)", name: "claim-en-file", overrides: { status: "QUEUED" } },
      { label: "générée récemment", name: "claim-recente", overrides: { createdAt: daysAgo(10) } },
      { label: "générée il y a exactement 60 jours", name: "claim-a-la-borne", overrides: { createdAt: CUTOFF } },
    ];

    for (const { label, name, overrides } of refused) {
      test(`ne réclame rien pour une vidéo ${label}`, async () => {
        const { id, outputKey } = await seedRow(name, overrides);
        const before = await prismaTest.captionJob.findUniqueOrThrow({ where: { id } });

        expect((await claim(id, { outputKey })).count).toBe(0);

        const after = await prismaTest.captionJob.findUniqueOrThrow({ where: { id } });
        expect(after.outputExpiredAt).toEqual(before.outputExpiredAt);
        expect(after.outputUrl).toBe(before.outputUrl);
        expect(after.outputKey).toBe(before.outputKey);
      });
    }
  });
});
