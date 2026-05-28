-- Phase 2.1 : fusion slot.caption + slot.description → slot.description.
-- Les deux champs servaient à la même chose conceptuelle (texte qui
-- accompagne le post Instagram). Avant de DROP, on backfill la
-- description pour ne pas perdre la donnée.

-- 1. Si description est NULL, on récupère caption.
UPDATE "PublicationSlot"
SET "description" = "caption"
WHERE "description" IS NULL
  AND "caption" IS NOT NULL;

-- 2. Drop de la colonne caption (la donnée a été migrée pour les slots qui
--    n'avaient que caption ; pour ceux qui avaient les deux, description
--    était l'intention CM la plus récente, on perd caption volontairement).
ALTER TABLE "PublicationSlot" DROP COLUMN "caption";
