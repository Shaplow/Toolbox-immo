-- Revert : les champs targetLanguage / autoTranslationPromptId /
-- autoCorrectionPromptId sur TranscriptionJob et le type sur CaptionPrompt
-- étaient utilisés par un panneau UI "Configuration auto" finalement
-- supprimé (UX trop chargée). Plus aucun code ne lit ni écrit ces colonnes,
-- on les drop. Le mode multi-langue continue via TranscriptionJob.languages.

ALTER TABLE "TranscriptionJob"
  DROP COLUMN IF EXISTS "targetLanguage",
  DROP COLUMN IF EXISTS "autoTranslationPromptId",
  DROP COLUMN IF EXISTS "autoCorrectionPromptId";

ALTER TABLE "CaptionPrompt"
  DROP COLUMN IF EXISTS "type";
