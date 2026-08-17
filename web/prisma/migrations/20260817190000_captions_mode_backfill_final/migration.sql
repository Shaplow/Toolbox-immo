-- V2.3 — backfill final avant décommission des colonnes captions Boolean.
--
-- La migration V8 (20260602100000) avait backfillé needsCaptionsModeOverride,
-- mais l'UI calendrier (tri-état SlotDetailPanel / one-off AddSlotModal) a
-- continué d'écrire le Boolean seul ensuite : les slots édités depuis juin
-- peuvent avoir bool non-null + mode null. On copie une dernière fois, puis
-- plus AUCUNE écriture/lecture du Boolean côté code — drop en N+1
-- (pending-drops/phase3-4-drops.sql).

UPDATE "PublicationSlot"
  SET "needsCaptionsModeOverride" = CASE
    WHEN "needsCaptionsOverride" = true THEN 'auto'
    ELSE 'none'
  END
  WHERE "needsCaptionsOverride" IS NOT NULL
    AND "needsCaptionsModeOverride" IS NULL;

-- Filet : recette dont le Boolean (true) contredit le mode ('none' = défaut
-- jamais renseigné). Le mode devient LA source unique — on aligne.
UPDATE "PatternTemplate"
  SET "needsCaptionsMode" = 'auto'
  WHERE "needsCaptions" = true
    AND "needsCaptionsMode" = 'none';
