/*
  Warnings:

  - A unique constraint covering the columns `[renderId]` on the table `TranscriptionJob` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "TranscriptionJob" ADD COLUMN     "renderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptionJob_renderId_key" ON "TranscriptionJob"("renderId");

-- AddForeignKey
ALTER TABLE "TranscriptionJob" ADD CONSTRAINT "TranscriptionJob_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "Render"("id") ON DELETE SET NULL ON UPDATE CASCADE;
