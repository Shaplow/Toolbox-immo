-- AlterTable
ALTER TABLE "PatternTemplate" ADD COLUMN     "autoActivateDayOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "autoActivatePublishTime" TEXT NOT NULL DEFAULT '09:00';

-- CreateTable
CREATE TABLE "PatternTemplateAutoActivation" (
    "id" TEXT NOT NULL,
    "patternTemplateId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "PatternTemplateAutoActivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatternTemplateAutoActivation_clientId_idx" ON "PatternTemplateAutoActivation"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PatternTemplateAutoActivation_patternTemplateId_clientId_key" ON "PatternTemplateAutoActivation"("patternTemplateId", "clientId");

-- AddForeignKey
ALTER TABLE "PatternTemplateAutoActivation" ADD CONSTRAINT "PatternTemplateAutoActivation_patternTemplateId_fkey" FOREIGN KEY ("patternTemplateId") REFERENCES "PatternTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternTemplateAutoActivation" ADD CONSTRAINT "PatternTemplateAutoActivation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
