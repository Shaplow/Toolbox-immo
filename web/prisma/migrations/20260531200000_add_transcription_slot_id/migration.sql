-- Phase V2 friction MED-2 du audit 2026-05-31 : permet de rattacher
-- directement une TranscriptionJob à un PublicationSlot, indépendamment
-- de render/version. Avant, une transcription créée standalone via
-- /transcriptions?slotId=X restait "orpheline" côté UI fiche pour les
-- patterns manual_rushes / external_upload sans render auto.
ALTER TABLE "TranscriptionJob" ADD COLUMN "slotId" TEXT;
CREATE INDEX "TranscriptionJob_slotId_createdAt_idx" ON "TranscriptionJob"("slotId", "createdAt");
ALTER TABLE "TranscriptionJob"
  ADD CONSTRAINT "TranscriptionJob_slotId_fkey"
  FOREIGN KEY ("slotId") REFERENCES "PublicationSlot"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
