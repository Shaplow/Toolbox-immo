-- Drop en N+1 — le drapeau « Brief éditorial » est mort côté code (15/09).
--
-- Le brief n'est plus conditionné à une case sur la recette : il s'affiche dès
-- qu'il y a quelque chose à lire ou quelqu'un pour l'écrire. Une case décochée
-- faisait passer la fonction pour supprimée — c'est exactement ce qui a été
-- vécu. Plus aucune lecture de ces colonnes ne subsiste :
--   * la case a disparu de PatternTemplateFields ;
--   * les deux surfaces d'override (SlotDetailPanel, AddSlotModal) aussi ;
--   * `steps.ts` (editVisible) et `lib/publications/roleNeeds.ts` (needsMonteur)
--     ne testent plus `needsBrief`.
--
-- AVANT de convertir en migration : vérifier qu'aucun code ne lit encore ces
-- colonnes (`grep -rn "needsBrief" web/src` doit ne rendre que des
-- commentaires), et `npm run db:backup`.

ALTER TABLE "PatternTemplate" DROP COLUMN IF EXISTS "needsBrief";
ALTER TABLE "PublicationSlot" DROP COLUMN IF EXISTS "needsBriefOverride";
-- AccountPattern est déjà décommissionné (cf. phase3-4-drops.sql) ; sa colonne
-- part avec la table, rien à faire ici.
