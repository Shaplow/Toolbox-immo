-- CreateIndex
CREATE INDEX "MediaAutocutJob_assetId_status_idx" ON "MediaAutocutJob"("assetId", "status");

-- CreateIndex
CREATE INDEX "MediaAutocutJob_libraryId_reviewStatus_idx" ON "MediaAutocutJob"("libraryId", "reviewStatus");

-- CreateIndex
CREATE INDEX "MediaEditJob_assetId_status_idx" ON "MediaEditJob"("assetId", "status");
