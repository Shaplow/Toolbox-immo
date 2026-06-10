-- AlterTable
ALTER TABLE "CaptionPrompt" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'correction';

-- AlterTable
ALTER TABLE "TranscriptionJob" ADD COLUMN     "autoCorrectionPromptId" TEXT,
ADD COLUMN     "autoTranslationPromptId" TEXT,
ADD COLUMN     "targetLanguage" TEXT;
