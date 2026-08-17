-- Plan simplification — drops différés des Phases 2/3/4 (cf. README.md).
-- À convertir en migration Prisma (avec l'édition du schema.prisma
-- correspondante : retrait des modèles/colonnes) au deploy N+1.

-- ── Phase 2 (AccountPattern) ────────────────────────────────────────────────
DROP INDEX IF EXISTS "PublicationSlot_patternId_idx";
ALTER TABLE "PublicationSlot" DROP COLUMN IF EXISTS "patternId";
DROP TABLE IF EXISTS "AccountPattern";
-- Colonnes captions legacy (enum needsCaptionsMode les remplace — vérifier
-- 0 lecture par grep avant) :
-- ALTER TABLE "PatternTemplate" DROP COLUMN IF EXISTS "needsCaptions";
-- ALTER TABLE "PublicationSlot" DROP COLUMN IF EXISTS "needsCaptionsOverride";
-- NB : needsCaptions est encore lu par resolveCaptionsMode → à traiter dans un
-- chantier captions dédié, PAS dans ce drop.

-- ── Phase 3 (rotation média) ────────────────────────────────────────────────
DROP TABLE IF EXISTS "AccountLibraryCursor";
ALTER TABLE "MediaLibrary" DROP COLUMN IF EXISTS "setSequence";
ALTER TABLE "MediaAsset" DROP COLUMN IF EXISTS "category";
ALTER TABLE "MediaLibrary" ALTER COLUMN "rotationMode" SET DEFAULT 'auto';
ALTER TABLE "MediaLibrary" ALTER COLUMN "rotationMode" SET NOT NULL;

-- ── Phase 4 (data) ──────────────────────────────────────────────────────────
DROP TABLE IF EXISTS "AccountDataLibraryCursor";
ALTER TABLE "DataEntry" DROP COLUMN IF EXISTS "campaignId";
ALTER TABLE "DataEntry" DROP COLUMN IF EXISTS "category";
ALTER TABLE "DataEntry" DROP COLUMN IF EXISTS "usedInCycle";
DROP TABLE IF EXISTS "DataCampaign";

-- ── Phase 5 (fieldSchema morts, si la Phase 5 est déployée) ────────────────
-- ALTER TABLE "PublicationSlot" DROP COLUMN IF EXISTS "fieldSchema";
-- ALTER TABLE "PatternTemplate" DROP COLUMN IF EXISTS "fieldSchema";
