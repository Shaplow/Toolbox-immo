-- Plan simplification Phase 3 (2026-08) — normalisation des modes de rotation.
-- Le mode « override » (séquence ordonnée + curseur) est décommissionné : il ne
-- reste que "auto" (tirage par dossier) et "none" (sélection metadata/manuelle).
-- Migration ADDITIVE (données seulement, pas de changement de schéma) : le drop
-- des colonnes/tables mortes (AccountLibraryCursor, MediaLibrary.setSequence,
-- MediaAsset.category) part au deploy N+1 après solde des renders en vol.

UPDATE "MediaLibrary"
SET "rotationMode" = 'auto'
WHERE "rotationMode" IS NULL OR "rotationMode" = 'override';

UPDATE "DataLibrary"
SET "rotationMode" = 'auto'
WHERE "rotationMode" IS NULL OR "rotationMode" = 'override';
