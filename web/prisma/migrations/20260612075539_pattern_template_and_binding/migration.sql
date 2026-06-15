-- AlterTable
ALTER TABLE "PublicationSlot" ADD COLUMN     "patternBindingId" TEXT;

-- CreateTable
CREATE TABLE "PatternTemplate" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "templateId" TEXT,
    "coverMode" TEXT NOT NULL DEFAULT 'none',
    "coverConfig" JSONB,
    "needsDescription" TEXT NOT NULL DEFAULT 'none',
    "needsCaptions" BOOLEAN NOT NULL DEFAULT false,
    "needsCaptionsMode" TEXT NOT NULL DEFAULT 'none',
    "needsAdminValidation" BOOLEAN NOT NULL DEFAULT false,
    "needsClientValidation" BOOLEAN NOT NULL DEFAULT false,
    "allowsClientRevision" BOOLEAN NOT NULL DEFAULT false,
    "needsBrief" BOOLEAN NOT NULL DEFAULT false,
    "captionPresetId" TEXT,
    "descriptionPromptId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatternTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternBinding" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "patternTemplateId" TEXT NOT NULL,
    "customLabel" TEXT,
    "dayOfWeek" INTEGER[],
    "publishTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultAssigneeMonteurId" TEXT,
    "defaultAssigneeCmId" TEXT,
    "defaultAssigneeVideasteId" TEXT,
    "templateIdOverride" TEXT,
    "captionPresetIdOverride" TEXT,
    "descriptionPromptIdOverride" TEXT,
    "coverModeOverride" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatternBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatternBinding_accountId_idx" ON "PatternBinding"("accountId");

-- CreateIndex
CREATE INDEX "PatternBinding_patternTemplateId_idx" ON "PatternBinding"("patternTemplateId");

-- CreateIndex
CREATE INDEX "PatternBinding_accountId_isActive_idx" ON "PatternBinding"("accountId", "isActive");

-- AddForeignKey
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_patternBindingId_fkey" FOREIGN KEY ("patternBindingId") REFERENCES "PatternBinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternTemplate" ADD CONSTRAINT "PatternTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternTemplate" ADD CONSTRAINT "PatternTemplate_captionPresetId_fkey" FOREIGN KEY ("captionPresetId") REFERENCES "CaptionPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternTemplate" ADD CONSTRAINT "PatternTemplate_descriptionPromptId_fkey" FOREIGN KEY ("descriptionPromptId") REFERENCES "DescriptionPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternBinding" ADD CONSTRAINT "PatternBinding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternBinding" ADD CONSTRAINT "PatternBinding_patternTemplateId_fkey" FOREIGN KEY ("patternTemplateId") REFERENCES "PatternTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternBinding" ADD CONSTRAINT "PatternBinding_defaultAssigneeMonteurId_fkey" FOREIGN KEY ("defaultAssigneeMonteurId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternBinding" ADD CONSTRAINT "PatternBinding_defaultAssigneeCmId_fkey" FOREIGN KEY ("defaultAssigneeCmId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternBinding" ADD CONSTRAINT "PatternBinding_defaultAssigneeVideasteId_fkey" FOREIGN KEY ("defaultAssigneeVideasteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternBinding" ADD CONSTRAINT "PatternBinding_templateIdOverride_fkey" FOREIGN KEY ("templateIdOverride") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternBinding" ADD CONSTRAINT "PatternBinding_captionPresetIdOverride_fkey" FOREIGN KEY ("captionPresetIdOverride") REFERENCES "CaptionPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternBinding" ADD CONSTRAINT "PatternBinding_descriptionPromptIdOverride_fkey" FOREIGN KEY ("descriptionPromptIdOverride") REFERENCES "DescriptionPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
