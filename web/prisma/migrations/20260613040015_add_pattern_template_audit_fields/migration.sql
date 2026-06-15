-- AlterTable
ALTER TABLE "PatternTemplate" ADD COLUMN     "updatedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "PatternTemplate" ADD CONSTRAINT "PatternTemplate_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
