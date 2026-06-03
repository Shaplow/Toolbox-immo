-- Curseur de rotation par compte pour DataLibrary (mirror simplifié de AccountLibraryCursor).
-- Pas de champ `cursor` Int : DataLibrary n'a pas de setSequence/mode override aujourd'hui.

CREATE TABLE IF NOT EXISTS "AccountDataLibraryCursor" (
    "id"               TEXT         NOT NULL,
    "accountId"        TEXT         NOT NULL,
    "libraryId"        TEXT         NOT NULL,
    "lastUsedSetTag"   TEXT,
    "lastUsedCategory" TEXT,
    "lastAdvancedAt"   TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountDataLibraryCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountDataLibraryCursor_accountId_libraryId_key"
    ON "AccountDataLibraryCursor"("accountId", "libraryId");

ALTER TABLE "AccountDataLibraryCursor" DROP CONSTRAINT IF EXISTS "AccountDataLibraryCursor_accountId_fkey";
ALTER TABLE "AccountDataLibraryCursor" ADD CONSTRAINT "AccountDataLibraryCursor_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccountDataLibraryCursor" DROP CONSTRAINT IF EXISTS "AccountDataLibraryCursor_libraryId_fkey";
ALTER TABLE "AccountDataLibraryCursor" ADD CONSTRAINT "AccountDataLibraryCursor_libraryId_fkey"
    FOREIGN KEY ("libraryId") REFERENCES "DataLibrary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
