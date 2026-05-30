-- Phase 1.x — ajout du schéma de champs au niveau DataLibrary.
--
-- Sert à :
--   1. générer un modèle CSV propre (avec les bonnes colonnes) même si la lib est vide
--   2. construire le form structuré "Nouvelle fiche"
--   3. valider les imports CSV / Excel
--
-- Format : JSON `[{ key, label, type, required? }]` avec types
-- "text" | "number" | "url" | "textarea".

ALTER TABLE "DataLibrary"
  ADD COLUMN "fieldsSchema" TEXT NOT NULL DEFAULT '[]';

-- Auto-déduction du schéma initial depuis les fields existants : pour chaque
-- lib qui a au moins une fiche, on prend la 1ère fiche, on lit ses clés (hors
-- set_tag/category), et on construit un schéma minimal text-only. L'admin
-- pourra l'ajuster ensuite via le settings drawer.
--
-- jsonb_agg sur les clés de fields → JSON `[{ key, label, type, required }]`.
UPDATE "DataLibrary" dl
SET "fieldsSchema" = sub.schema_json::text
FROM (
  SELECT
    dl_inner.id AS lib_id,
    jsonb_agg(
      jsonb_build_object(
        'key', k,
        'label', k,
        'type', 'text',
        'required', false
      )
      ORDER BY k
    ) AS schema_json
  FROM "DataLibrary" dl_inner
  JOIN "DataCampaign" dc ON dc."libraryId" = dl_inner.id
  CROSS JOIN LATERAL (
    SELECT de.fields
    FROM "DataEntry" de
    WHERE de."campaignId" = dc.id
    ORDER BY de."createdAt" ASC
    LIMIT 1
  ) first_entry
  CROSS JOIN LATERAL jsonb_object_keys(first_entry.fields::jsonb) AS k
  WHERE k NOT IN ('set_tag', 'category')
  GROUP BY dl_inner.id
) sub
WHERE dl.id = sub.lib_id;
