-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "labelIsCustom" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "EntityType" ADD COLUMN     "labelTemplate" TEXT;

-- Backfill : toutes les fiches existantes portent un libellé SAISI À LA MAIN
-- (aucun modèle n'existait avant cette migration). Sans cet UPDATE, la première
-- édition de leurs champs, une fois un modèle posé sur leur type, réécrirait
-- silencieusement « 12 rue des Lilas » en repli daté.
-- Sûr ici : à cet instant aucun EntityType n'a de labelTemplate, le drapeau
-- reste donc inerte jusqu'à la première configuration.
UPDATE "Entity" SET "labelIsCustom" = true;
