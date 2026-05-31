-- V6 — Active jobs + stale invalidation
--
-- 1) Ajoute staleSince / staleReason sur 4 modèles Job (captions, description,
--    cover, transcription). Signal d'obsolescence — quand l'input upstream
--    change (promote nouvelle version, render replaced), les jobs aval sont
--    marqués stale plutôt que supprimés. Reste consultable + badge UI.
--
-- 2) Ajoute 3 FK sur PublicationSlot pour matérialiser le concept "job actif"
--    (= celui affiché dans la fiche). Avant : "latest by createdAt" — trompeur
--    quand un retry PROCESSING masquait un COMPLETED précédent. Désormais
--    explicit via slot.activeCaptionJobId / activeCoverPackId /
--    activeTranscriptionJobId. Pas d'activeDescriptionJobId — la description
--    vit dans slot.description (texte).
--
-- Tous les champs sont nullables + onDelete SetNull, donc additifs et safe
-- pour prod (pas de blocage existant).

-- CaptionJob
ALTER TABLE "CaptionJob" ADD COLUMN "staleSince" TIMESTAMP(3);
ALTER TABLE "CaptionJob" ADD COLUMN "staleReason" TEXT;

-- TranscriptionJob
ALTER TABLE "TranscriptionJob" ADD COLUMN "staleSince" TIMESTAMP(3);
ALTER TABLE "TranscriptionJob" ADD COLUMN "staleReason" TEXT;

-- CoverFramePack
ALTER TABLE "CoverFramePack" ADD COLUMN "staleSince" TIMESTAMP(3);
ALTER TABLE "CoverFramePack" ADD COLUMN "staleReason" TEXT;

-- DescriptionJob (pas d'activeForSlot — description vit dans slot.description)
ALTER TABLE "DescriptionJob" ADD COLUMN "staleSince" TIMESTAMP(3);
ALTER TABLE "DescriptionJob" ADD COLUMN "staleReason" TEXT;

-- PublicationSlot — 3 FK "active*" + contraintes unique (1 slot ↔ 1 job actif)
ALTER TABLE "PublicationSlot" ADD COLUMN "activeCaptionJobId" TEXT;
ALTER TABLE "PublicationSlot" ADD COLUMN "activeCoverPackId" TEXT;
ALTER TABLE "PublicationSlot" ADD COLUMN "activeTranscriptionJobId" TEXT;

CREATE UNIQUE INDEX "PublicationSlot_activeCaptionJobId_key"
  ON "PublicationSlot"("activeCaptionJobId");
CREATE UNIQUE INDEX "PublicationSlot_activeCoverPackId_key"
  ON "PublicationSlot"("activeCoverPackId");
CREATE UNIQUE INDEX "PublicationSlot_activeTranscriptionJobId_key"
  ON "PublicationSlot"("activeTranscriptionJobId");

ALTER TABLE "PublicationSlot"
  ADD CONSTRAINT "PublicationSlot_activeCaptionJobId_fkey"
  FOREIGN KEY ("activeCaptionJobId") REFERENCES "CaptionJob"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PublicationSlot"
  ADD CONSTRAINT "PublicationSlot_activeCoverPackId_fkey"
  FOREIGN KEY ("activeCoverPackId") REFERENCES "CoverFramePack"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PublicationSlot"
  ADD CONSTRAINT "PublicationSlot_activeTranscriptionJobId_fkey"
  FOREIGN KEY ("activeTranscriptionJobId") REFERENCES "TranscriptionJob"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
