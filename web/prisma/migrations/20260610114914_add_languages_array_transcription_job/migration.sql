-- AlterTable
ALTER TABLE "TranscriptionJob" ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[];
