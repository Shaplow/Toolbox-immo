-- CreateTable
CREATE TABLE "TemplateCoverPreset" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TemplateCoverPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateCoverPreset_templateId_name_key" ON "TemplateCoverPreset"("templateId", "name");

-- CreateIndex
CREATE INDEX "TemplateCoverPreset_templateId_idx" ON "TemplateCoverPreset"("templateId");

-- AddForeignKey
ALTER TABLE "TemplateCoverPreset" ADD CONSTRAINT "TemplateCoverPreset_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
