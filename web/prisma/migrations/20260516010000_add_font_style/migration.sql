-- AlterTable: add fontStyle column with default "normal"
ALTER TABLE "FontAsset" ADD COLUMN "fontStyle" TEXT NOT NULL DEFAULT 'normal';

-- Drop the (family, weight) unique index added in the previous migration
DROP INDEX IF EXISTS "FontAsset_family_weight_key";

-- Create new composite unique index on (family, weight, fontStyle)
CREATE UNIQUE INDEX "FontAsset_family_weight_fontStyle_key" ON "FontAsset"("family", "weight", "fontStyle");
