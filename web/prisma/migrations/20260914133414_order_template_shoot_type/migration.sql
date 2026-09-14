-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shootTypeId" TEXT;

-- AlterTable
ALTER TABLE "OrderTemplateRecipe" ADD COLUMN     "shootTypeId" TEXT;

-- AlterTable
ALTER TABLE "PatternTemplate" ADD COLUMN     "clientDescription" TEXT,
ADD COLUMN     "clientLabel" TEXT;

-- CreateTable
CREATE TABLE "OrderTemplateShootType" (
    "id" TEXT NOT NULL,
    "orderTemplateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "videosDecidedLater" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderTemplateShootType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderTemplateShootType_orderTemplateId_idx" ON "OrderTemplateShootType"("orderTemplateId");

-- CreateIndex
CREATE INDEX "OrderTemplateRecipe_shootTypeId_idx" ON "OrderTemplateRecipe"("shootTypeId");

-- AddForeignKey
ALTER TABLE "OrderTemplateRecipe" ADD CONSTRAINT "OrderTemplateRecipe_shootTypeId_fkey" FOREIGN KEY ("shootTypeId") REFERENCES "OrderTemplateShootType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateShootType" ADD CONSTRAINT "OrderTemplateShootType_orderTemplateId_fkey" FOREIGN KEY ("orderTemplateId") REFERENCES "OrderTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shootTypeId_fkey" FOREIGN KEY ("shootTypeId") REFERENCES "OrderTemplateShootType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Retire « Type de tournage » de la fiche Tournage.
--
-- Semé la veille par 20260914120000, il était PUREMENT DÉCLARATIF : la constante
-- SHOOT_SUBTYPE_FIELD_KEY n'avait aucun consommateur, le champ ne pilotait rien.
-- Le type de tournage vit désormais sur le MODÈLE DE COMMANDE
-- (OrderTemplateShootType, créé ci-dessus), là où il détermine réellement
-- quelles vidéos sont cochables.
--
-- Mêmes précautions que la migration qui l'a posé : correspondance de texte
-- EXACTE (le repo stocke fieldSchema en String, et `IS JSON` est du PostgreSQL
-- 16+ dont la disponibilité en prod n'est garantie nulle part), idempotente,
-- et bornée à l'unique type système concerné.
--
-- SI L'ADMIN A ÉDITÉ CE CHAMP entre-temps (options, libellé, obligatoire), la
-- chaîne ne correspond plus et le champ SURVIT. C'est le bon échec : on ne
-- supprime pas une configuration que quelqu'un a délibérément retouchée. Il
-- reste alors retirable à la main dans Types de fiches.
--
-- Les valeurs déjà saisies restent dans Entity.fields, simplement ignorées —
-- rien à purger, et elles réapparaîtraient si le champ était recréé.

-- Cas « seul champ du schéma » — c'est l'état nominal en base.
UPDATE "EntityType"
SET "fieldSchema" = '[]'
WHERE "id" = 'etype_tournage'
  AND "fieldSchema" = '[{"key":"type_tournage","label":"Type de tournage","type":"select","options":["RVA","RPOD","Interview"]}]';

-- Cas « parmi d'autres champs » — la migration de seed l'ajoutait toujours en
-- fin de tableau, mais on couvre aussi la position de tête par sécurité.
UPDATE "EntityType"
SET "fieldSchema" = replace(
      replace(
        "fieldSchema",
        ',{"key":"type_tournage","label":"Type de tournage","type":"select","options":["RVA","RPOD","Interview"]}',
        ''
      ),
      '{"key":"type_tournage","label":"Type de tournage","type":"select","options":["RVA","RPOD","Interview"]},',
      ''
    )
WHERE "id" = 'etype_tournage'
  AND "fieldSchema" LIKE '%"key":"type_tournage"%';
