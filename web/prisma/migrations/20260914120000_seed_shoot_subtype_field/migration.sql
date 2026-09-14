-- Ajoute le champ « Type de tournage » au type système « Tournage ».
--
-- RVA, RPOD et interview ne sont pas trois types de fiches : ce sont trois
-- façons de tourner. Trois EntityType auraient coûté trois onglets sur /fiches,
-- trois OrderTemplateItem à tenir, et `instantiateOrderSlots` qui ne retient
-- qu'une seule fiche tournage par commande (.find, pas .filter) en aurait
-- ignoré deux sur trois. Un champ à choix fermé évite tout ça.
--
-- Posé par migration et non à la main dans l'admin : un champ créé en prod
-- n'existerait ni en local ni sur la base e2e, et la clé `type_tournage`
-- (cf. SHOOT_SUBTYPE_FIELD_KEY) deviendrait non fiable pour tout code qui
-- voudra s'y raccrocher.
--
-- Deux gardes, chacune nécessaire :
--   · fieldSchema NOT LIKE '%"key":"type_tournage"%' → rejouable, et n'écrase
--     jamais un champ que l'admin aurait déjà créé sous ce nom.
--   · le CASE sur '[]'                               → un schéma vide reçoit un
--     tableau d'un élément ; un schéma peuplé se voit APPENDRE le champ, sans
--     perdre l'existant.
--
-- Volontairement en manipulation de texte et non en `::jsonb` : le repo stocke
-- fieldSchema en String et `IS JSON` est une syntaxe PostgreSQL 16+, dont la
-- disponibilité en prod n'est garantie nulle part. serializeCustomFields sort
-- du JSON compact sans espace après « : » — les motifs sont donc exacts.
--
-- Le champ n'est PAS `required` : le rendre obligatoire avant que le blocage à
-- l'enregistrement n'ait son garde-fou de backfill rendrait insauvable chaque
-- tournage déjà en base.
UPDATE "EntityType"
SET "fieldSchema" = CASE
  WHEN trim("fieldSchema") IN ('', '[]') THEN
    '[{"key":"type_tournage","label":"Type de tournage","type":"select","options":["RVA","RPOD","Interview"]}]'
  ELSE
    left(trim("fieldSchema"), -1)
    || ',{"key":"type_tournage","label":"Type de tournage","type":"select","options":["RVA","RPOD","Interview"]}]'
END
WHERE "id" = 'etype_tournage'
  AND "fieldSchema" NOT LIKE '%"key":"type_tournage"%'
  AND trim("fieldSchema") LIKE '[%]';
