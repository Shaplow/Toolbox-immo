-- AlterTable AccountPattern : dayOfWeek Int → Int[]
-- 1. Ajouter colonne temporaire
ALTER TABLE "AccountPattern" ADD COLUMN "dayOfWeek_new" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- 2. Copier les valeurs scalaires en arrays single-element
UPDATE "AccountPattern" SET "dayOfWeek_new" = ARRAY["dayOfWeek"];

-- 3. Drop l'ancienne colonne
ALTER TABLE "AccountPattern" DROP COLUMN "dayOfWeek";

-- 4. Renommer la nouvelle colonne
ALTER TABLE "AccountPattern" RENAME COLUMN "dayOfWeek_new" TO "dayOfWeek";

-- 5. Retirer le default (le code doit fournir le tableau)
ALTER TABLE "AccountPattern" ALTER COLUMN "dayOfWeek" DROP DEFAULT;
