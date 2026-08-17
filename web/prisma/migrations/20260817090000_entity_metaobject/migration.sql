-- Plan simplification Phase 5 — métaobjet Entity/EntityType (fusion
-- Property « Bien » + ShootEvent « Tournage »).
-- Migration ADDITIVE : nouvelles tables + nouvelles FK + seed des 2 types
-- système + backfill id-preserving (les Entity reprennent les ids des
-- Property/ShootEvent — cuid, collision impossible). Les anciennes tables et
-- FK restent en place jusqu'au drop N+1 (cf. prisma/pending-drops/).

-- AlterTable
ALTER TABLE "PatternTemplate" ADD COLUMN     "requiresEntityTypeId" TEXT;

-- AlterTable
ALTER TABLE "PublicationRush" ADD COLUMN     "entityId" TEXT;

-- AlterTable
ALTER TABLE "PublicationSlot" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "shootEntityId" TEXT;

-- CreateTable
CREATE TABLE "EntityType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "namePlural" TEXT,
    "icon" TEXT,
    "fieldSchema" TEXT NOT NULL DEFAULT '[]',
    "hasPlanning" BOOLEAN NOT NULL DEFAULT false,
    "hasAccount" BOOLEAN NOT NULL DEFAULT false,
    "hasRushes" BOOLEAN NOT NULL DEFAULT false,
    "hasAssignees" BOOLEAN NOT NULL DEFAULT false,
    "visibility" TEXT NOT NULL DEFAULT 'admin',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fields" TEXT NOT NULL DEFAULT '{}',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "accountId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "shotAt" TIMESTAMP(3),
    "status" TEXT,
    "assigneeVideasteId" TEXT,
    "defaultAssigneeMonteurId" TEXT,
    "defaultAssigneeCmId" TEXT,
    "notes" TEXT,
    "brief" TEXT,
    "relatedEntityId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityActivity" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Entity_typeId_isArchived_label_idx" ON "Entity"("typeId", "isArchived", "label");

-- CreateIndex
CREATE INDEX "Entity_accountId_scheduledAt_idx" ON "Entity"("accountId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Entity_status_scheduledAt_idx" ON "Entity"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Entity_assigneeVideasteId_idx" ON "Entity"("assigneeVideasteId");

-- CreateIndex
CREATE INDEX "Entity_relatedEntityId_idx" ON "Entity"("relatedEntityId");

-- CreateIndex
CREATE INDEX "EntityActivity_entityId_createdAt_idx" ON "EntityActivity"("entityId", "createdAt");

-- CreateIndex
CREATE INDEX "PublicationRush_entityId_deletedAt_idx" ON "PublicationRush"("entityId", "deletedAt");

-- CreateIndex
CREATE INDEX "PublicationSlot_entityId_idx" ON "PublicationSlot"("entityId");

-- CreateIndex
CREATE INDEX "PublicationSlot_shootEntityId_idx" ON "PublicationSlot"("shootEntityId");

-- AddForeignKey
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_shootEntityId_fkey" FOREIGN KEY ("shootEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "EntityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_assigneeVideasteId_fkey" FOREIGN KEY ("assigneeVideasteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_defaultAssigneeMonteurId_fkey" FOREIGN KEY ("defaultAssigneeMonteurId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_defaultAssigneeCmId_fkey" FOREIGN KEY ("defaultAssigneeCmId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_relatedEntityId_fkey" FOREIGN KEY ("relatedEntityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityActivity" ADD CONSTRAINT "EntityActivity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityActivity" ADD CONSTRAINT "EntityActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternTemplate" ADD CONSTRAINT "PatternTemplate_requiresEntityTypeId_fkey" FOREIGN KEY ("requiresEntityTypeId") REFERENCES "EntityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationRush" ADD CONSTRAINT "PublicationRush_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Seed des types système ───────────────────────────────────────────────────
-- fieldSchema du type « Bien » ← modèle par défaut AppSetting (fallback '[]').
INSERT INTO "EntityType" ("id", "name", "namePlural", "icon", "fieldSchema", "hasPlanning", "hasAccount", "hasRushes", "hasAssignees", "visibility", "position", "isSystem", "updatedAt")
VALUES (
  'etype_bien', 'Bien', 'Biens', 'home',
  COALESCE((SELECT "value" FROM "AppSetting" WHERE "key" = 'property.defaultFieldSchema'), '[]'),
  false, false, false, false, 'admin', 0, true, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "EntityType" ("id", "name", "namePlural", "icon", "fieldSchema", "hasPlanning", "hasAccount", "hasRushes", "hasAssignees", "visibility", "position", "isSystem", "updatedAt")
VALUES (
  'etype_tournage', 'Tournage', 'Tournages', 'clapperboard', '[]',
  true, true, true, true, 'team', 1, true, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- ── Backfill id-preserving : Property → Entity (type Bien) ───────────────────
INSERT INTO "Entity" ("id", "typeId", "label", "fields", "isArchived", "createdByUserId", "createdAt", "updatedAt")
SELECT p."id", 'etype_bien', p."label", p."fields", p."isArchived", p."createdByUserId", p."createdAt", p."updatedAt"
FROM "Property" p
ON CONFLICT ("id") DO NOTHING;

-- ── Backfill id-preserving : ShootEvent → Entity (type Tournage) ─────────────
INSERT INTO "Entity" ("id", "typeId", "label", "fields", "isArchived",
  "accountId", "scheduledAt", "endAt", "shotAt", "status",
  "assigneeVideasteId", "defaultAssigneeMonteurId", "defaultAssigneeCmId",
  "notes", "brief", "relatedEntityId", "createdByUserId", "createdAt", "updatedAt")
SELECT e."id", 'etype_tournage', e."title", '{}', (e."status" = 'CANCELLED'),
  e."accountId", e."scheduledAt", e."endAt", e."shotAt", e."status",
  e."assigneeVideasteId", e."defaultAssigneeMonteurId", e."defaultAssigneeCmId",
  e."notes", e."brief", e."propertyId", e."createdByUserId", e."createdAt", e."updatedAt"
FROM "ShootEvent" e
ON CONFLICT ("id") DO NOTHING;

-- ── Backfill journal : ShootEventActivity → EntityActivity (ids repris) ──────
INSERT INTO "EntityActivity" ("id", "entityId", "actorId", "type", "payload", "createdAt")
SELECT a."id", a."eventId", a."actorId", a."type", a."payload", a."createdAt"
FROM "ShootEventActivity" a
ON CONFLICT ("id") DO NOTHING;

-- ── Backfill des FK ──────────────────────────────────────────────────────────
UPDATE "PublicationSlot" SET "entityId" = "propertyId" WHERE "propertyId" IS NOT NULL AND "entityId" IS NULL;
UPDATE "PublicationSlot" SET "shootEntityId" = "eventId" WHERE "eventId" IS NOT NULL AND "shootEntityId" IS NULL;
UPDATE "PublicationRush" SET "entityId" = "eventId" WHERE "eventId" IS NOT NULL AND "entityId" IS NULL;
UPDATE "PatternTemplate" SET "requiresEntityTypeId" = 'etype_bien' WHERE "requiresProperty" = true AND "requiresEntityTypeId" IS NULL;
