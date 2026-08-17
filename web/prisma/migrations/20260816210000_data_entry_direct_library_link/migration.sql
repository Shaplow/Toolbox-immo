-- Plan simplification Phase 4 — DataEntry rattachée directement à DataLibrary.
-- Le wrapper DataCampaign (usagePolicy jamais lu par le moteur) est
-- décommissionné : migration ADDITIVE (libraryId + backfill + campaignId
-- nullable). Drop de DataCampaign/campaignId/category/usedInCycle au deploy N+1.

ALTER TABLE "DataEntry" ADD COLUMN "libraryId" TEXT;

UPDATE "DataEntry" de
SET "libraryId" = dc."libraryId"
FROM "DataCampaign" dc
WHERE de."campaignId" = dc.id;

-- Entries orphelines (campagne supprimée entre-temps) : impossible en théorie
-- (FK Cascade), mais on guard quand même avant le NOT NULL.
DELETE FROM "DataEntry" WHERE "libraryId" IS NULL;

ALTER TABLE "DataEntry" ALTER COLUMN "libraryId" SET NOT NULL;

ALTER TABLE "DataEntry"
  ADD CONSTRAINT "DataEntry_libraryId_fkey"
  FOREIGN KEY ("libraryId") REFERENCES "DataLibrary"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "DataEntry_libraryId_idx" ON "DataEntry"("libraryId");

-- Le code n'écrit plus campaignId : élargissement en nullable.
ALTER TABLE "DataEntry" ALTER COLUMN "campaignId" DROP NOT NULL;
