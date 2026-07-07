-- CreateIndex
CREATE INDEX "MediaAsset_libraryId_createdAt_idx" ON "MediaAsset"("libraryId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAssetUsage_accountId_idx" ON "MediaAssetUsage"("accountId");
