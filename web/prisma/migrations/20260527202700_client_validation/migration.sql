-- AlterTable AccountPattern : add allowsClientRevision
ALTER TABLE "AccountPattern" ADD COLUMN "allowsClientRevision" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable PublicationSlot : per-slot overrides for client validation config
ALTER TABLE "PublicationSlot" ADD COLUMN "needsClientValidationOverride" BOOLEAN;
ALTER TABLE "PublicationSlot" ADD COLUMN "allowsClientRevisionOverride" BOOLEAN;

-- CreateTable ClientValidationToken
CREATE TABLE "ClientValidationToken" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    CONSTRAINT "ClientValidationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientValidationToken_tokenHash_key" ON "ClientValidationToken"("tokenHash");
CREATE INDEX "ClientValidationToken_slotId_revokedAt_idx" ON "ClientValidationToken"("slotId", "revokedAt");

ALTER TABLE "ClientValidationToken" ADD CONSTRAINT "ClientValidationToken_slotId_fkey"
    FOREIGN KEY ("slotId") REFERENCES "PublicationSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientValidationToken" ADD CONSTRAINT "ClientValidationToken_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable ClientValidationRound
CREATE TABLE "ClientValidationRound" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientValidationRound_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientValidationRound_slotId_roundNumber_key" ON "ClientValidationRound"("slotId", "roundNumber");
CREATE INDEX "ClientValidationRound_slotId_respondedAt_idx" ON "ClientValidationRound"("slotId", "respondedAt");

ALTER TABLE "ClientValidationRound" ADD CONSTRAINT "ClientValidationRound_slotId_fkey"
    FOREIGN KEY ("slotId") REFERENCES "PublicationSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
