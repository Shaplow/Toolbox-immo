-- Ajout des champs rotation manquants sur MediaLibrary.
--
-- Contexte : `rotationMode` et `maxUsageCount` sont dans le schema Prisma
-- depuis longtemps (mirror du modèle DataLibrary) mais aucune migration
-- ne les avait ajoutés à PostgreSQL. Sur les DB qui ont été créées via
-- `db push` (dev legacy) les colonnes existent ; sur les DB neuves
-- (toolbox_test fraîche, CI) elles manquaient → seed et Prisma read
-- cassaient avec "column does not exist".
--
-- Default `rotationMode` = null (lecture côté code retombe sur "auto" via
-- fallback). `maxUsageCount` = null par défaut (= illimité, sémantique
-- alignée sur DataLibrary).

ALTER TABLE "MediaLibrary"
  ADD COLUMN IF NOT EXISTS "rotationMode"  TEXT,
  ADD COLUMN IF NOT EXISTS "maxUsageCount" INTEGER;
