-- Phase 2.5 : refonte des modes cover.
-- Avant : "auto" | "manualSelect" | "none"
-- Après : "none" | "manualSelect" | "autoPack" | "monteurUpload"
--
-- "auto" → "autoPack" (rename) : la sémantique reste la même côté code
-- (génération d'un pack de frames + sélection CM). Le nom est plus explicite.
--
-- "monteurUpload" : nouveau mode où le monteur uploade directement la cover
-- en même temps qu'il livre le montage. Pas de génération auto.
--
-- Migration data : tous les patterns et overrides slot "auto" deviennent
-- "autoPack". Les overrides slot null restent null (héritent du pattern).

UPDATE "AccountPattern"
SET "coverMode" = 'autoPack'
WHERE "coverMode" = 'auto';

UPDATE "PublicationSlot"
SET "coverModeOverride" = 'autoPack'
WHERE "coverModeOverride" = 'auto';
