-- Seed sentinel rows InstagramAccount pour satisfaire les FK
-- AccountLibraryCursor.accountId et AccountDataLibraryCursor.accountId
-- en mode rotationScope=shared.
--
-- Voir contentLibraryResolver.ts:
--   SHARED_CURSOR_ACCOUNT_ID = "__shared__"
--   SHARED_DATA_CURSOR_ACCOUNT_ID = "__shared__data__"
--
-- Ces rows ne représentent pas de vrais comptes ; elles servent juste
-- de cible pour la FK. clientId reste NULL (donc invisibles dans la
-- liste des comptes par client).

INSERT INTO "InstagramAccount" ("id", "name", "handle", "clientId", "createdAt", "updatedAt")
VALUES
  ('__shared__',       '⟂ Curseur partagé (Media)', '__shared__',       NULL, NOW(), NOW()),
  ('__shared__data__', '⟂ Curseur partagé (Data)',  '__shared__data__', NULL, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
