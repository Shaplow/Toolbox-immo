-- Sépare les prompts et les jobs par usage : "description" (légende Instagram)
-- vs "brief" (brief de montage pour le monteur).
--
-- Le DEFAULT rend la migration non-destructive : tous les prompts et jobs
-- existants restent des "description", donc les pickers actuels ne changent pas
-- de contenu.

-- AlterTable
ALTER TABLE "DescriptionPrompt"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'description';

-- AlterTable
ALTER TABLE "DescriptionJob"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'description';

-- CreateIndex
CREATE INDEX "DescriptionPrompt_kind_isActive_idx" ON "DescriptionPrompt"("kind", "isActive");

-- CreateIndex
-- Les deux listings filtrent sur userId + kind et trient par createdAt desc.
CREATE INDEX "DescriptionJob_userId_kind_createdAt_idx" ON "DescriptionJob"("userId", "kind", "createdAt");
