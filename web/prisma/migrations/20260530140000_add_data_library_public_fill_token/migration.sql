-- Phase 1.x Vague 3 — token de remplissage public sur DataLibrary.
-- Quand non-null, la lib expose `/data-fill/<token>` (page sans auth)
-- où un externe peut soumettre des fiches. Révocable depuis l'admin.

ALTER TABLE "DataLibrary"
  ADD COLUMN "publicFillToken" TEXT;

CREATE UNIQUE INDEX "DataLibrary_publicFillToken_key" ON "DataLibrary"("publicFillToken");
