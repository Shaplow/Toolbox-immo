/*
  Warnings:

  - A unique constraint covering the columns `[currentVersionId]` on the table `PublicationSlot` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "InstagramAccount" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "OfferScheduleRule" ADD COLUMN     "deprecated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deprecatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PublicationSlot" ADD COLUMN     "assigneeCmId" TEXT,
ADD COLUMN     "assigneeMonteurId" TEXT,
ADD COLUMN     "currentVersionId" TEXT,
ADD COLUMN     "recipeId" TEXT;

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRecipe" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "templateId" TEXT,
    "libraryId" TEXT,
    "needsDescription" TEXT NOT NULL DEFAULT 'none',
    "needsCover" TEXT NOT NULL DEFAULT 'none',
    "needsCaptions" BOOLEAN NOT NULL DEFAULT false,
    "needsClientValidation" BOOLEAN NOT NULL DEFAULT false,
    "defaultAssigneeMonteurId" TEXT,
    "defaultAssigneeCmId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountPlan" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "publishTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationVersion" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "r2Key" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "mimeType" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "uploadedByUserId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentRecipe_code_key" ON "ContentRecipe"("code");

-- CreateIndex
CREATE INDEX "AccountPlan_accountId_idx" ON "AccountPlan"("accountId");

-- CreateIndex
CREATE INDEX "AccountPlan_dayOfWeek_idx" ON "AccountPlan"("dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "AccountPlan_accountId_dayOfWeek_publishTime_recipeId_key" ON "AccountPlan"("accountId", "dayOfWeek", "publishTime", "recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationVersion_r2Key_key" ON "PublicationVersion"("r2Key");

-- CreateIndex
CREATE INDEX "PublicationVersion_slotId_idx" ON "PublicationVersion"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationVersion_slotId_versionNumber_key" ON "PublicationVersion"("slotId", "versionNumber");

-- CreateIndex
CREATE INDEX "InstagramAccount_clientId_idx" ON "InstagramAccount"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationSlot_currentVersionId_key" ON "PublicationSlot"("currentVersionId");

-- CreateIndex
CREATE INDEX "PublicationSlot_assigneeMonteurId_idx" ON "PublicationSlot"("assigneeMonteurId");

-- CreateIndex
CREATE INDEX "PublicationSlot_assigneeCmId_idx" ON "PublicationSlot"("assigneeCmId");

-- CreateIndex
CREATE INDEX "PublicationSlot_recipeId_idx" ON "PublicationSlot"("recipeId");

-- AddForeignKey
ALTER TABLE "InstagramAccount" ADD CONSTRAINT "InstagramAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_assigneeMonteurId_fkey" FOREIGN KEY ("assigneeMonteurId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_assigneeCmId_fkey" FOREIGN KEY ("assigneeCmId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "ContentRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "PublicationVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRecipe" ADD CONSTRAINT "ContentRecipe_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRecipe" ADD CONSTRAINT "ContentRecipe_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "MediaLibrary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRecipe" ADD CONSTRAINT "ContentRecipe_defaultAssigneeMonteurId_fkey" FOREIGN KEY ("defaultAssigneeMonteurId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRecipe" ADD CONSTRAINT "ContentRecipe_defaultAssigneeCmId_fkey" FOREIGN KEY ("defaultAssigneeCmId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPlan" ADD CONSTRAINT "AccountPlan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPlan" ADD CONSTRAINT "AccountPlan_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "ContentRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationVersion" ADD CONSTRAINT "PublicationVersion_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "PublicationSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationVersion" ADD CONSTRAINT "PublicationVersion_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
