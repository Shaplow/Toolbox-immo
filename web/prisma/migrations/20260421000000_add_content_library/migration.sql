-- AlterTable: add usedAssets column to Render
ALTER TABLE "Render" ADD COLUMN IF NOT EXISTS "usedAssets" TEXT NOT NULL DEFAULT '{}';

-- CreateTable: MediaLibrary
CREATE TABLE IF NOT EXISTS "MediaLibrary" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MediaAsset
CREATE TABLE IF NOT EXISTS "MediaAsset" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "duration" DOUBLE PRECISION,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DataLibrary
CREATE TABLE IF NOT EXISTS "DataLibrary" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateType" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DataCampaign
CREATE TABLE IF NOT EXISTS "DataCampaign" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "cycleResetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DataEntry
CREATE TABLE IF NOT EXISTS "DataEntry" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fields" TEXT NOT NULL DEFAULT '{}',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "usedInCycle" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MediaAsset_r2Key_key" ON "MediaAsset"("r2Key");

-- AddForeignKey: MediaAsset → MediaLibrary
ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_libraryId_fkey";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_libraryId_fkey"
    FOREIGN KEY ("libraryId") REFERENCES "MediaLibrary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DataCampaign → DataLibrary
ALTER TABLE "DataCampaign" DROP CONSTRAINT IF EXISTS "DataCampaign_libraryId_fkey";
ALTER TABLE "DataCampaign" ADD CONSTRAINT "DataCampaign_libraryId_fkey"
    FOREIGN KEY ("libraryId") REFERENCES "DataLibrary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DataEntry → DataCampaign
ALTER TABLE "DataEntry" DROP CONSTRAINT IF EXISTS "DataEntry_campaignId_fkey";
ALTER TABLE "DataEntry" ADD CONSTRAINT "DataEntry_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "DataCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
