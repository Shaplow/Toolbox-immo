-- AlterTable
ALTER TABLE "InstagramAccount" ADD COLUMN     "defaultAssigneeCmId" TEXT,
ADD COLUMN     "defaultAssigneeMonteurId" TEXT,
ADD COLUMN     "defaultAssigneeVideasteId" TEXT;

-- AddForeignKey
ALTER TABLE "InstagramAccount" ADD CONSTRAINT "InstagramAccount_defaultAssigneeVideasteId_fkey" FOREIGN KEY ("defaultAssigneeVideasteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramAccount" ADD CONSTRAINT "InstagramAccount_defaultAssigneeMonteurId_fkey" FOREIGN KEY ("defaultAssigneeMonteurId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramAccount" ADD CONSTRAINT "InstagramAccount_defaultAssigneeCmId_fkey" FOREIGN KEY ("defaultAssigneeCmId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
