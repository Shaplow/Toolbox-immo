-- AlterTable
ALTER TABLE "CoverFrameCandidate" ALTER COLUMN "imageUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CoverFramePack" ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "extractAttempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "runpodJobId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CoverFramePack_runpodJobId_key" ON "CoverFramePack"("runpodJobId");

