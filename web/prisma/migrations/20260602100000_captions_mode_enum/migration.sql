-- V8.2.1 — needsCaptions Boolean → needsCaptionsMode enum String.
--
-- Avant : `AccountPattern.needsCaptions: Boolean` ne supportait que
-- "auto via preset" (true) ou "rien" (false). Pas de moyen d'exposer
-- "écrire à la main via CaptionEditor".
--
-- Désormais : enum String "none" | "auto" | "manual" sur le pattern et son
-- override per-slot. Le mode `manual` ouvre une page CaptionEditor dans
-- la fiche pub pour saisir des sous-titres à la main.
--
-- Stratégie de migration safe :
-- 1. Ajout colonne `needsCaptionsMode` String? avec default "none"
-- 2. Backfill : true → "auto", false → "none"
-- 3. NOT NULL après backfill (default "none" préservé)
-- 4. Conserve `needsCaptions` Boolean en parallèle (déprécié, jamais lu)
--    pour rollback. Drop définitif après vérification logs (~1 mois).
-- 5. Idem pour override : `needsCaptionsModeOverride: String?` sur
--    PublicationSlot, backfill depuis `needsCaptionsOverride: Boolean?`.

-- AccountPattern
ALTER TABLE "AccountPattern"
  ADD COLUMN "needsCaptionsMode" TEXT NOT NULL DEFAULT 'none';

UPDATE "AccountPattern"
  SET "needsCaptionsMode" = CASE
    WHEN "needsCaptions" = true THEN 'auto'
    ELSE 'none'
  END;

-- PublicationSlot — override per-slot
ALTER TABLE "PublicationSlot"
  ADD COLUMN "needsCaptionsModeOverride" TEXT;

UPDATE "PublicationSlot"
  SET "needsCaptionsModeOverride" = CASE
    WHEN "needsCaptionsOverride" = true THEN 'auto'
    WHEN "needsCaptionsOverride" = false THEN 'none'
    ELSE NULL
  END;
