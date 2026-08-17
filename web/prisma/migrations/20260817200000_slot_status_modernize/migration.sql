-- V2.5 — statuts 22 → 16 : backfill des 6 valeurs supprimées vers leurs
-- équivalents modernes (mêmes phase/owner que dans les maps UI qui les
-- traduisaient jusqu'ici), puis default DB moderne.
--
--   TO_DO            → PLANNED       (phase "planned", owner ADMIN)
--   READY            → READY_FOR_CM  (phase "cm_review", owner CM)
--   CHECKING         → READY_FOR_CM  (phase "cm_review", owner CM)
--   DONE             → PUBLISHED     (terminal succès)
--   REJECTED         → CANCELLED     (0 écrivain depuis W2)
--   CAPTIONS_PENDING → IN_PROGRESS   (cible jamais atteinte par le pipeline)
--
-- IN_PROGRESS reste : le pipeline auto_template l'écrit activement.

UPDATE "PublicationSlot" SET "status" = CASE "status"
  WHEN 'TO_DO' THEN 'PLANNED'
  WHEN 'READY' THEN 'READY_FOR_CM'
  WHEN 'CHECKING' THEN 'READY_FOR_CM'
  WHEN 'DONE' THEN 'PUBLISHED'
  WHEN 'REJECTED' THEN 'CANCELLED'
  WHEN 'CAPTIONS_PENDING' THEN 'IN_PROGRESS'
  ELSE "status"
END
WHERE "status" IN ('TO_DO', 'READY', 'CHECKING', 'DONE', 'REJECTED', 'CAPTIONS_PENDING');

ALTER TABLE "PublicationSlot" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
