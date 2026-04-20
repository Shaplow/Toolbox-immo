-- AlterTable
ALTER TABLE "CaptionJob" ADD COLUMN     "inputKey" TEXT,
ADD COLUMN     "previewMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "srtFilename" TEXT;
