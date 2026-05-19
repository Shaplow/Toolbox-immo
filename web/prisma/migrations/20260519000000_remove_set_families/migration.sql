-- Remove unused setFamilies column from MediaLibrary.
-- This field was written but never read; removing it simplifies the model.
ALTER TABLE "MediaLibrary" DROP COLUMN IF EXISTS "setFamilies";
