-- Migration additive: add captionPresetId + descriptionPromptId FK on AccountPattern
-- Phase 2.0 E1 — safe to apply without downtime

ALTER TABLE "AccountPattern"
  ADD COLUMN "captionPresetId" TEXT,
  ADD COLUMN "descriptionPromptId" TEXT;

ALTER TABLE "AccountPattern"
  ADD CONSTRAINT "AccountPattern_captionPresetId_fkey"
    FOREIGN KEY ("captionPresetId") REFERENCES "CaptionPreset"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AccountPattern_descriptionPromptId_fkey"
    FOREIGN KEY ("descriptionPromptId") REFERENCES "DescriptionPrompt"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
