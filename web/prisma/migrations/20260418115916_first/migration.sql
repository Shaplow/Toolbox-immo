/*
  Warnings:

  - A unique constraint covering the columns `[runpodJobId]` on the table `CaptionJob` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[runpodJobId]` on the table `Render` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[runpodJobId]` on the table `TranscriptionJob` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "CaptionJob" ADD COLUMN     "errorMsg" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CaptionJob_runpodJobId_key" ON "CaptionJob"("runpodJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Render_runpodJobId_key" ON "Render"("runpodJobId");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptionJob_runpodJobId_key" ON "TranscriptionJob"("runpodJobId");
