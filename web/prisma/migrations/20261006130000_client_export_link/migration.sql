-- CreateTable
CREATE TABLE "ClientExportLink" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "accountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mediaLibraryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dataLibraryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includePublications" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "firstOpenedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),
    "downloadStartedAt" TIMESTAMP(3),
    "downloadCompletedAt" TIMESTAMP(3),
    "startCount" INTEGER NOT NULL DEFAULT 0,
    "lastReport" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientExportLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientExportLink_tokenHash_key" ON "ClientExportLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ClientExportLink_clientId_createdAt_idx" ON "ClientExportLink"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClientExportLink" ADD CONSTRAINT "ClientExportLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientExportLink" ADD CONSTRAINT "ClientExportLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

