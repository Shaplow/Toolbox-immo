-- AlterTable
ALTER TABLE "CaptionJob" ADD COLUMN     "lastAccessedAt" TIMESTAMP(3),
ADD COLUMN     "outputExpiredAt" TIMESTAMP(3);
