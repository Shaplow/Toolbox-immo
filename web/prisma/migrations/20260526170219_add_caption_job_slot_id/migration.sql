-- AlterTable
ALTER TABLE "CaptionJob" ADD COLUMN "slotId" TEXT;

-- AddForeignKey
ALTER TABLE "CaptionJob" ADD CONSTRAINT "CaptionJob_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "PublicationSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "CaptionJob_slotId_idx" ON "CaptionJob"("slotId");
