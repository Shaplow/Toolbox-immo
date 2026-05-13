-- ============================================================
-- Migration: add_calendar_and_library_updates
-- Covers all schema additions made via db push since
-- 20260421000000_add_content_library.
-- All statements are idempotent (IF NOT EXISTS / IF NOT EXISTS checks).
-- ============================================================

-- ─── 1. MediaLibrary — new columns ──────────────────────────
ALTER TABLE "MediaLibrary" ADD COLUMN IF NOT EXISTS "setSequence"   TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "MediaLibrary" ADD COLUMN IF NOT EXISTS "setFamilies"   TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "MediaLibrary" ADD COLUMN IF NOT EXISTS "rotationScope" TEXT NOT NULL DEFAULT 'per_account';

-- ─── 2. MediaAsset — new columns ────────────────────────────
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "setTag"   TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "category" TEXT;

-- ─── 3. MediaEditJob ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MediaEditJob" (
    "id"        TEXT        NOT NULL,
    "assetId"   TEXT        NOT NULL,
    "status"    TEXT        NOT NULL DEFAULT 'pending',
    "params"    TEXT        NOT NULL DEFAULT '{}',
    "runpodId"  TEXT,
    "errorMsg"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaEditJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MediaEditJob_runpodId_key" ON "MediaEditJob"("runpodId");
ALTER TABLE "MediaEditJob" DROP CONSTRAINT IF EXISTS "MediaEditJob_assetId_fkey";
ALTER TABLE "MediaEditJob" ADD CONSTRAINT "MediaEditJob_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 4. DataCampaign — new column ───────────────────────────
ALTER TABLE "DataCampaign" ADD COLUMN IF NOT EXISTS "usagePolicy" TEXT NOT NULL DEFAULT 'cycle';

-- ─── 5. DataEntry — new columns ─────────────────────────────
ALTER TABLE "DataEntry" ADD COLUMN IF NOT EXISTS "setTag"   TEXT;
ALTER TABLE "DataEntry" ADD COLUMN IF NOT EXISTS "category" TEXT;

-- ─── 6. InstagramAccount ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "InstagramAccount" (
    "id"        TEXT         NOT NULL,
    "name"      TEXT         NOT NULL,
    "handle"    TEXT         NOT NULL,
    "offre"     TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstagramAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InstagramAccount_handle_key" ON "InstagramAccount"("handle");

-- ─── 7. MediaAssetAccess ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MediaAssetAccess" (
    "assetId"   TEXT NOT NULL,
    "accountId" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "MediaAssetAccess_assetId_accountId_key" ON "MediaAssetAccess"("assetId", "accountId");
ALTER TABLE "MediaAssetAccess" DROP CONSTRAINT IF EXISTS "MediaAssetAccess_assetId_fkey";
ALTER TABLE "MediaAssetAccess" ADD CONSTRAINT "MediaAssetAccess_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAssetAccess" DROP CONSTRAINT IF EXISTS "MediaAssetAccess_accountId_fkey";
ALTER TABLE "MediaAssetAccess" ADD CONSTRAINT "MediaAssetAccess_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 8. MediaAssetUsage ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MediaAssetUsage" (
    "assetId"    TEXT         NOT NULL,
    "accountId"  TEXT         NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "usageCount" INTEGER      NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "MediaAssetUsage_assetId_accountId_key" ON "MediaAssetUsage"("assetId", "accountId");
ALTER TABLE "MediaAssetUsage" DROP CONSTRAINT IF EXISTS "MediaAssetUsage_assetId_fkey";
ALTER TABLE "MediaAssetUsage" ADD CONSTRAINT "MediaAssetUsage_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAssetUsage" DROP CONSTRAINT IF EXISTS "MediaAssetUsage_accountId_fkey";
ALTER TABLE "MediaAssetUsage" ADD CONSTRAINT "MediaAssetUsage_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 9. AccountLibraryCursor ────────────────────────────────
CREATE TABLE IF NOT EXISTS "AccountLibraryCursor" (
    "id"               TEXT         NOT NULL,
    "accountId"        TEXT         NOT NULL,
    "libraryId"        TEXT         NOT NULL,
    "cursor"           INTEGER      NOT NULL DEFAULT 0,
    "lastUsedSetTag"   TEXT,
    "lastUsedCategory" TEXT,
    "lastAdvancedAt"   TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountLibraryCursor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AccountLibraryCursor_accountId_libraryId_key" ON "AccountLibraryCursor"("accountId", "libraryId");
ALTER TABLE "AccountLibraryCursor" DROP CONSTRAINT IF EXISTS "AccountLibraryCursor_accountId_fkey";
ALTER TABLE "AccountLibraryCursor" ADD CONSTRAINT "AccountLibraryCursor_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountLibraryCursor" DROP CONSTRAINT IF EXISTS "AccountLibraryCursor_libraryId_fkey";
ALTER TABLE "AccountLibraryCursor" ADD CONSTRAINT "AccountLibraryCursor_libraryId_fkey"
    FOREIGN KEY ("libraryId") REFERENCES "MediaLibrary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 10. DataEntryAccess ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DataEntryAccess" (
    "entryId"   TEXT NOT NULL,
    "accountId" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "DataEntryAccess_entryId_accountId_key" ON "DataEntryAccess"("entryId", "accountId");
ALTER TABLE "DataEntryAccess" DROP CONSTRAINT IF EXISTS "DataEntryAccess_entryId_fkey";
ALTER TABLE "DataEntryAccess" ADD CONSTRAINT "DataEntryAccess_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "DataEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataEntryAccess" DROP CONSTRAINT IF EXISTS "DataEntryAccess_accountId_fkey";
ALTER TABLE "DataEntryAccess" ADD CONSTRAINT "DataEntryAccess_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 11. DataEntryUsage ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DataEntryUsage" (
    "entryId"    TEXT         NOT NULL,
    "accountId"  TEXT         NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "usageCount" INTEGER      NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "DataEntryUsage_entryId_accountId_key" ON "DataEntryUsage"("entryId", "accountId");
ALTER TABLE "DataEntryUsage" DROP CONSTRAINT IF EXISTS "DataEntryUsage_entryId_fkey";
ALTER TABLE "DataEntryUsage" ADD CONSTRAINT "DataEntryUsage_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "DataEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataEntryUsage" DROP CONSTRAINT IF EXISTS "DataEntryUsage_accountId_fkey";
ALTER TABLE "DataEntryUsage" ADD CONSTRAINT "DataEntryUsage_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 12. OfferScheduleRule ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "OfferScheduleRule" (
    "id"          TEXT         NOT NULL,
    "offre"       TEXT         NOT NULL,
    "dayOfWeek"   INTEGER      NOT NULL,
    "publishTime" TEXT         NOT NULL,
    "contentType" TEXT         NOT NULL,
    "isActive"    BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OfferScheduleRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OfferScheduleRule_offre_dayOfWeek_publishTime_contentType_key"
    ON "OfferScheduleRule"("offre", "dayOfWeek", "publishTime", "contentType");
CREATE INDEX IF NOT EXISTS "OfferScheduleRule_offre_idx"     ON "OfferScheduleRule"("offre");
CREATE INDEX IF NOT EXISTS "OfferScheduleRule_dayOfWeek_idx" ON "OfferScheduleRule"("dayOfWeek");

-- ─── 13. PublicationSlot ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PublicationSlot" (
    "id"          TEXT         NOT NULL,
    "accountId"   TEXT         NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "contentType" TEXT         NOT NULL,
    "status"      TEXT         NOT NULL DEFAULT 'TO_DO',
    "title"       TEXT,
    "caption"     TEXT,
    "fields"      TEXT         NOT NULL DEFAULT '{}',
    "fieldSchema" TEXT         NOT NULL DEFAULT '[]',
    "templateId"  TEXT,
    "isAuto"      BOOLEAN      NOT NULL DEFAULT false,
    "notes"       TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicationSlot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PublicationSlot_accountId_scheduledAt_idx" ON "PublicationSlot"("accountId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "PublicationSlot_status_scheduledAt_idx"    ON "PublicationSlot"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "PublicationSlot_contentType_scheduledAt_idx" ON "PublicationSlot"("contentType", "scheduledAt");
ALTER TABLE "PublicationSlot" DROP CONSTRAINT IF EXISTS "PublicationSlot_accountId_fkey";
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicationSlot" DROP CONSTRAINT IF EXISTS "PublicationSlot_templateId_fkey";
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── 14. Render — new columns ───────────────────────────────
ALTER TABLE "Render" ADD COLUMN IF NOT EXISTS "accountId"         TEXT;
ALTER TABLE "Render" ADD COLUMN IF NOT EXISTS "publicationSlotId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Render_publicationSlotId_key" ON "Render"("publicationSlotId");
ALTER TABLE "Render" DROP CONSTRAINT IF EXISTS "Render_accountId_fkey";
ALTER TABLE "Render" ADD CONSTRAINT "Render_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Render" DROP CONSTRAINT IF EXISTS "Render_publicationSlotId_fkey";
ALTER TABLE "Render" ADD CONSTRAINT "Render_publicationSlotId_fkey"
    FOREIGN KEY ("publicationSlotId") REFERENCES "PublicationSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
