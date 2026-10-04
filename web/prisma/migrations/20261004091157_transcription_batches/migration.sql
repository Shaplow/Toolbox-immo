-- AlterTable
ALTER TABLE "TranscriptionJob" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "uploadedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TranscriptionJob_userId_createdAt_idx" ON "TranscriptionJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TranscriptionJob_userId_batchId_idx" ON "TranscriptionJob"("userId", "batchId");
