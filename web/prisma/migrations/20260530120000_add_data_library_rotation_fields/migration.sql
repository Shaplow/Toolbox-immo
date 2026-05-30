-- Phase 1.x — ajout des réglages rotation au niveau DataLibrary
-- (mirror MediaLibrary : rotationMode + rotationScope + maxUsageCount).
--
-- Le concept DataCampaign devient invisible côté UI (refonte Légère).
-- La sélection de fiches lit désormais les réglages au niveau lib,
-- la `usagePolicy` campaign reste en place pour rétrocompatibilité
-- et pour le moteur legacy (campagne unique "Default" auto-créée).
--
-- Backfill : pour chaque DataLibrary, on lit l'usagePolicy de sa
-- campagne active (isActive=true) et on populate les 3 nouveaux champs
-- via le mapping legacy → 2D :
--   - unlimited / cycle    → auto / shared      / null
--   - once_global          → auto / shared      / 1
--   - cycle_per_account    → auto / per_account / null
--   - once_per_account     → auto / per_account / 1

ALTER TABLE "DataLibrary"
  ADD COLUMN "rotationMode"  TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN "rotationScope" TEXT NOT NULL DEFAULT 'shared',
  ADD COLUMN "maxUsageCount" INTEGER;

-- Backfill scope + maxUsage depuis la usagePolicy de la campagne active
UPDATE "DataLibrary" dl
SET
  "rotationScope" = CASE
    WHEN dc."usagePolicy" IN ('cycle_per_account', 'once_per_account') THEN 'per_account'
    ELSE 'shared'
  END,
  "maxUsageCount" = CASE
    WHEN dc."usagePolicy" IN ('once_global', 'once_per_account') THEN 1
    ELSE NULL
  END
FROM "DataCampaign" dc
WHERE dc."libraryId" = dl.id
  AND dc."isActive" = true;
