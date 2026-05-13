-- AlterTable: ajoute contentType sur Template
ALTER TABLE "Template" ADD COLUMN "contentType" TEXT NOT NULL DEFAULT '';

-- AlterTable: ajoute templateId (FK nullable) sur OfferScheduleRule
ALTER TABLE "OfferScheduleRule" ADD COLUMN "templateId" TEXT;

-- CreateIndex
CREATE INDEX "OfferScheduleRule_templateId_idx" ON "OfferScheduleRule"("templateId");

-- AddForeignKey
ALTER TABLE "OfferScheduleRule" ADD CONSTRAINT "OfferScheduleRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
