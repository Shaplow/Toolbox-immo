-- Phase 2.3 : flag needsAdminValidation pour activer/désactiver la
-- validation admin du montage (intercalation du status EDIT_REVIEW).
--
-- Défaut false : par défaut le monteur uploade une version → auto-promote
-- → CM continue. L'admin peut activer le garde-fou au pattern ou au slot.

-- 1. AccountPattern : ajout du flag avec default false
ALTER TABLE "AccountPattern"
  ADD COLUMN "needsAdminValidation" BOOLEAN NOT NULL DEFAULT false;

-- 2. PublicationSlot : override per-slot (null = hérite du pattern)
ALTER TABLE "PublicationSlot"
  ADD COLUMN "needsAdminValidationOverride" BOOLEAN;
