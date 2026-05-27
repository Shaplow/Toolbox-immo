-- Phase 5 — Slots one-off : 3 overrides supplémentaires sur PublicationSlot
-- + nullabilité de CoverFramePack.renderId + ajout publicationVersionId
-- pour permettre des packs créés sur une version uploadée manuellement
-- (slot one-off rush externe sans render auto).

-- AlterTable PublicationSlot : overrides supplémentaires
ALTER TABLE "PublicationSlot" ADD COLUMN "coverModeOverride" TEXT;
ALTER TABLE "PublicationSlot" ADD COLUMN "coverPresetIdOverride" TEXT;
ALTER TABLE "PublicationSlot" ADD COLUMN "captionPresetIdOverride" TEXT;
ALTER TABLE "PublicationSlot" ADD COLUMN "descriptionPromptIdOverride" TEXT;

ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_coverPresetIdOverride_fkey"
    FOREIGN KEY ("coverPresetIdOverride") REFERENCES "TemplateCoverPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_captionPresetIdOverride_fkey"
    FOREIGN KEY ("captionPresetIdOverride") REFERENCES "CaptionPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_descriptionPromptIdOverride_fkey"
    FOREIGN KEY ("descriptionPromptIdOverride") REFERENCES "DescriptionPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable CoverFramePack : renderId devient nullable + onDelete change Cascade → SetNull
-- + ajout publicationVersionId (relation alternative pour les packs manuels)
ALTER TABLE "CoverFramePack" DROP CONSTRAINT "CoverFramePack_renderId_fkey";
ALTER TABLE "CoverFramePack" ALTER COLUMN "renderId" DROP NOT NULL;
ALTER TABLE "CoverFramePack" ADD CONSTRAINT "CoverFramePack_renderId_fkey"
    FOREIGN KEY ("renderId") REFERENCES "Render"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CoverFramePack" ADD COLUMN "publicationVersionId" TEXT;
CREATE UNIQUE INDEX "CoverFramePack_publicationVersionId_key" ON "CoverFramePack"("publicationVersionId");
ALTER TABLE "CoverFramePack" ADD CONSTRAINT "CoverFramePack_publicationVersionId_fkey"
    FOREIGN KEY ("publicationVersionId") REFERENCES "PublicationVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
