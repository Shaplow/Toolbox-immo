-- Active le libellé automatique sur le type système « Bien ».
--
-- Le moteur de libellé (EntityType.labelTemplate) est livré mais inerte tant
-- qu'aucun modèle n'est posé : l'invariant « modèle vide ⇒ saisie à la main »
-- faisait qu'il ne s'était jamais déclenché nulle part, et personne n'avait vu
-- passer le réglage.
--
-- Trois gardes, chacune nécessaire :
--   · labelTemplate IS NULL  → rejouable, et n'écrase jamais un réglage manuel.
--   · les deux LIKE          → no-op là où le type n'a pas ces champs, ce qui
--                              couvre la base e2e (le seed y crée etype_bien
--                              avec fieldSchema = '[]'). Ne pas les retirer :
--                              setup-test-db.ts applique bien `migrate deploy`
--                              sur toolbox_test, ce sont eux qui la protègent.
--
-- Volontairement en LIKE et non en `IS JSON ARRAY` / `::jsonb` : la première
-- est une syntaxe PostgreSQL 16+, et la version majeure de la prod n'est
-- garantie nulle part. serializeCustomFields sort du JSON compact, sans espace
-- après « : » — le motif est donc exact.
--
-- Les fiches existantes ne bougent pas : le backfill du 09/09 les a toutes
-- marquées labelIsCustom = true.
UPDATE "EntityType"
SET "labelTemplate" = '{{nom_du_mandant}} — {{rue}}'
WHERE "id" = 'etype_bien'
  AND "labelTemplate" IS NULL
  AND "fieldSchema" LIKE '%"key":"nom_du_mandant"%'
  AND "fieldSchema" LIKE '%"key":"rue"%';
