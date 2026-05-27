-- AlterTable PublicationSlot : ajout des 4 overrides per-slot pour les `needs*` du pattern
-- Permet à un slot d'overrider la config héritée du pattern sans toucher au pattern lui-même.
-- null = hérite du pattern (comportement par défaut).

ALTER TABLE "PublicationSlot" ADD COLUMN "needsCaptionsOverride" BOOLEAN;
ALTER TABLE "PublicationSlot" ADD COLUMN "needsDescriptionOverride" TEXT;
ALTER TABLE "PublicationSlot" ADD COLUMN "needsRushesOverride" BOOLEAN;
ALTER TABLE "PublicationSlot" ADD COLUMN "needsBriefOverride" BOOLEAN;
