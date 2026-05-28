-- Phase 2.4 : ajout du lien TranscriptionJob → PublicationVersion pour
-- supporter la chaîne auto sur manual_rushes / external_upload (sans render).
-- Mutuellement exclusif avec renderId en pratique (l'un ou l'autre, pas
-- les deux à la fois).

ALTER TABLE "TranscriptionJob"
  ADD COLUMN "publicationVersionId" TEXT;

ALTER TABLE "TranscriptionJob"
  ADD CONSTRAINT "TranscriptionJob_publicationVersionId_key"
  UNIQUE ("publicationVersionId");

ALTER TABLE "TranscriptionJob"
  ADD CONSTRAINT "TranscriptionJob_publicationVersionId_fkey"
  FOREIGN KEY ("publicationVersionId")
  REFERENCES "PublicationVersion"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
