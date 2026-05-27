-- Ajoute la FK DescriptionJob.slotId → PublicationSlot pour relier les jobs de
-- description IA à une publication. Alimente la ProductionChain (step
-- "Description") qui restait bloquée à "todo" car aucun lien job ↔ slot
-- n'existait jusqu'ici.

-- AlterTable
ALTER TABLE "DescriptionJob" ADD COLUMN "slotId" TEXT;

-- AddForeignKey
ALTER TABLE "DescriptionJob" ADD CONSTRAINT "DescriptionJob_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "PublicationSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "DescriptionJob_slotId_idx" ON "DescriptionJob"("slotId");
