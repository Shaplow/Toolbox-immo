-- AlterTable
ALTER TABLE "CaptionJob" ADD COLUMN     "outputKey" TEXT,
ADD COLUMN     "runpodJobId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'QUEUED';
