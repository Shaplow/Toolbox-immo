-- AlterTable: add weight column with default 400
ALTER TABLE "FontAsset" ADD COLUMN "weight" INTEGER NOT NULL DEFAULT 400;

-- Drop old unique index on family
DROP INDEX IF EXISTS "FontAsset_family_key";

-- Create composite unique index on (family, weight)
CREATE UNIQUE INDEX "FontAsset_family_weight_key" ON "FontAsset"("family", "weight");
