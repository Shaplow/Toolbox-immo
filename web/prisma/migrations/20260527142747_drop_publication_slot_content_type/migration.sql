-- Drop PublicationSlot.contentType (redondant avec pattern.label).
--
-- Pour les slots historiques sans pattern lié, on préserve l'information en
-- recopiant contentType dans title si title est NULL ou vide. Les nouveaux
-- consumers utilisent `slot.pattern?.label ?? slot.title ?? "Publication"`.

-- 1. Préserve l'info contentType dans title pour les slots sans titre
UPDATE "PublicationSlot"
SET "title" = "contentType"
WHERE ("title" IS NULL OR "title" = '') AND "contentType" IS NOT NULL AND "contentType" <> '';

-- 2. Drop l'index dédié
DROP INDEX IF EXISTS "PublicationSlot_contentType_scheduledAt_idx";

-- 3. Drop la colonne
ALTER TABLE "PublicationSlot" DROP COLUMN "contentType";
