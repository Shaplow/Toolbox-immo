/*
  Warnings:

  - You are about to drop the column `recipeId` on the `PublicationSlot` table. All the data in the column will be lost.
  - You are about to drop the `AccountPlan` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ContentRecipe` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OfferScheduleRule` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AccountPlan" DROP CONSTRAINT "AccountPlan_accountId_fkey";

-- DropForeignKey
ALTER TABLE "AccountPlan" DROP CONSTRAINT "AccountPlan_recipeId_fkey";

-- DropForeignKey
ALTER TABLE "ContentRecipe" DROP CONSTRAINT "ContentRecipe_defaultAssigneeCmId_fkey";

-- DropForeignKey
ALTER TABLE "ContentRecipe" DROP CONSTRAINT "ContentRecipe_defaultAssigneeMonteurId_fkey";

-- DropForeignKey
ALTER TABLE "ContentRecipe" DROP CONSTRAINT "ContentRecipe_libraryId_fkey";

-- DropForeignKey
ALTER TABLE "ContentRecipe" DROP CONSTRAINT "ContentRecipe_templateId_fkey";

-- DropForeignKey
ALTER TABLE "OfferScheduleRule" DROP CONSTRAINT "OfferScheduleRule_templateId_fkey";

-- DropForeignKey
ALTER TABLE "PublicationSlot" DROP CONSTRAINT "PublicationSlot_recipeId_fkey";

-- DropIndex
DROP INDEX "PublicationSlot_recipeId_idx";

-- AlterTable
ALTER TABLE "PublicationSlot" DROP COLUMN "recipeId",
ADD COLUMN     "patternId" TEXT;

-- DropTable
DROP TABLE "AccountPlan";

-- DropTable
DROP TABLE "ContentRecipe";

-- DropTable
DROP TABLE "OfferScheduleRule";

-- CreateTable
CREATE TABLE "AccountPattern" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "templateId" TEXT,
    "libraryId" TEXT,
    "coverMode" TEXT NOT NULL DEFAULT 'none',
    "coverConfig" JSONB,
    "needsDescription" TEXT NOT NULL DEFAULT 'none',
    "needsCaptions" BOOLEAN NOT NULL DEFAULT false,
    "needsClientValidation" BOOLEAN NOT NULL DEFAULT false,
    "needsRushes" BOOLEAN NOT NULL DEFAULT false,
    "needsBrief" BOOLEAN NOT NULL DEFAULT false,
    "dayOfWeek" INTEGER NOT NULL,
    "publishTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultAssigneeMonteurId" TEXT,
    "defaultAssigneeCmId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountPattern_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountPattern_accountId_idx" ON "AccountPattern"("accountId");

-- CreateIndex
CREATE INDEX "AccountPattern_accountId_isActive_idx" ON "AccountPattern"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "PublicationSlot_patternId_idx" ON "PublicationSlot"("patternId");

-- AddForeignKey
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "AccountPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPattern" ADD CONSTRAINT "AccountPattern_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPattern" ADD CONSTRAINT "AccountPattern_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPattern" ADD CONSTRAINT "AccountPattern_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "MediaLibrary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPattern" ADD CONSTRAINT "AccountPattern_defaultAssigneeMonteurId_fkey" FOREIGN KEY ("defaultAssigneeMonteurId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPattern" ADD CONSTRAINT "AccountPattern_defaultAssigneeCmId_fkey" FOREIGN KEY ("defaultAssigneeCmId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
