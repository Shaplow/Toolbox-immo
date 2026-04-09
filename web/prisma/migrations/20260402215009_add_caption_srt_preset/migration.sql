-- AlterTable
ALTER TABLE "CaptionJob" ADD COLUMN     "presetId" TEXT,
ADD COLUMN     "srtContent" TEXT;

-- AlterTable
ALTER TABLE "FontAsset" ALTER COLUMN "updatedAt" DROP DEFAULT;
