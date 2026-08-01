-- Un slot peut désormais porter PLUSIEURS rendus (historique des re-renders).
--
-- Avant : `Render.publicationSlotId` était unique, donc un re-render ne pouvait
-- pas être rattaché au slot sans détacher le précédent. La route de création
-- laissait donc le nouveau rendu orphelin quand l'ancien était DONE, et la fiche
-- continuait d'afficher l'ancienne vidéo indéfiniment.
--
-- Après : le lien devient un simple index, et le rendu qui fait foi est pointé
-- par `PublicationSlot.currentRenderId`. Il n'est promu qu'à la complétion du
-- rendu, ce qui préserve la vidéo précédente pendant toute la durée du re-render
-- et en cas d'échec.

DROP INDEX IF EXISTS "Render_publicationSlotId_key";
CREATE INDEX IF NOT EXISTS "Render_publicationSlotId_idx" ON "Render"("publicationSlotId");

ALTER TABLE "PublicationSlot" ADD COLUMN IF NOT EXISTS "currentRenderId" TEXT;

-- Backfill : le rendu actuellement rattaché devient le rendu courant.
-- L'unicité précédente garantit qu'il y en a au plus un par slot.
UPDATE "PublicationSlot" ps
SET "currentRenderId" = r."id"
FROM "Render" r
WHERE r."publicationSlotId" = ps."id"
  AND ps."currentRenderId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "PublicationSlot_currentRenderId_key" ON "PublicationSlot"("currentRenderId");

ALTER TABLE "PublicationSlot" DROP CONSTRAINT IF EXISTS "PublicationSlot_currentRenderId_fkey";
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_currentRenderId_fkey"
  FOREIGN KEY ("currentRenderId") REFERENCES "Render"("id") ON DELETE SET NULL ON UPDATE CASCADE;
