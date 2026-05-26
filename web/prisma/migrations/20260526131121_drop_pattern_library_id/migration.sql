-- AlterTable: drop libraryId from AccountPattern
ALTER TABLE "AccountPattern" DROP CONSTRAINT IF EXISTS "AccountPattern_libraryId_fkey";
ALTER TABLE "AccountPattern" DROP COLUMN IF EXISTS "libraryId";
