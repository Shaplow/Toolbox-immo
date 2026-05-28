-- AlterTable
ALTER TABLE "DescriptionPrompt"
  ADD COLUMN "recipeKind"   TEXT NOT NULL DEFAULT 'transcript_only',
  ADD COLUMN "recipeConfig" JSONB;
