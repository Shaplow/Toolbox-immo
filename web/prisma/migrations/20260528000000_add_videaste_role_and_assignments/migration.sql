-- AlterTable PublicationSlot : assignation Vidéaste (le filmeur qui upload les rushs)
ALTER TABLE "PublicationSlot" ADD COLUMN "assigneeVideasteId" TEXT;
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_assigneeVideasteId_fkey"
    FOREIGN KEY ("assigneeVideasteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PublicationSlot_assigneeVideasteId_idx" ON "PublicationSlot"("assigneeVideasteId");

-- AlterTable AccountPattern : vidéaste par défaut (sym. monteur/cm)
ALTER TABLE "AccountPattern" ADD COLUMN "defaultAssigneeVideasteId" TEXT;
ALTER TABLE "AccountPattern" ADD CONSTRAINT "AccountPattern_defaultAssigneeVideasteId_fkey"
    FOREIGN KEY ("defaultAssigneeVideasteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
