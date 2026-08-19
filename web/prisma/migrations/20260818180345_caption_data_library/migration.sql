-- DropIndex
DROP INDEX "Render_publicationSlotId_idx";

-- AlterTable
ALTER TABLE "PatternTemplate" ADD COLUMN     "descriptionDataLibraryId" TEXT;

-- AlterTable
ALTER TABLE "PublicationSlot" ADD COLUMN     "captionDataEntryId" TEXT;

-- CreateIndex
CREATE INDEX "PublicationSlot_captionDataEntryId_idx" ON "PublicationSlot"("captionDataEntryId");

-- AddForeignKey
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_captionDataEntryId_fkey" FOREIGN KEY ("captionDataEntryId") REFERENCES "DataEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternTemplate" ADD CONSTRAINT "PatternTemplate_descriptionDataLibraryId_fkey" FOREIGN KEY ("descriptionDataLibraryId") REFERENCES "DataLibrary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
