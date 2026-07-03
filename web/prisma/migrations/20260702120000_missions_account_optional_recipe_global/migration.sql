-- AlterTable: PublicationSlot.accountId devient nullable (missions sans compte)
ALTER TABLE "PublicationSlot" ALTER COLUMN "accountId" DROP NOT NULL;

-- AlterTable: PublicationSlot — liaison directe vers une recette globale
ALTER TABLE "PublicationSlot" ADD COLUMN     "patternTemplateId" TEXT;

-- AlterTable: PatternTemplate — champs missions (schéma de champs perso hérités + auto-save biblio)
ALTER TABLE "PatternTemplate" ADD COLUMN     "fieldSchema" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "autoSaveToLibraryId" TEXT;

-- AlterTable: MediaAsset — provenance (auto-save mission)
ALTER TABLE "MediaAsset" ADD COLUMN     "source" TEXT,
ADD COLUMN     "sourceRenderId" TEXT;

-- CreateIndex
CREATE INDEX "PublicationSlot_patternTemplateId_idx" ON "PublicationSlot"("patternTemplateId");

-- AddForeignKey
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_patternTemplateId_fkey" FOREIGN KEY ("patternTemplateId") REFERENCES "PatternTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternTemplate" ADD CONSTRAINT "PatternTemplate_autoSaveToLibraryId_fkey" FOREIGN KEY ("autoSaveToLibraryId") REFERENCES "MediaLibrary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
