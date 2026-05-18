-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "metadata" TEXT NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "MediaLibrary" ADD COLUMN     "metadataSchema" TEXT NOT NULL DEFAULT '[]';
