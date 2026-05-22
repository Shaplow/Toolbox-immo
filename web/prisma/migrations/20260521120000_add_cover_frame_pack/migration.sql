-- CreateTable
CREATE TABLE "CoverFramePack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "renderId" TEXT NOT NULL,
    "templateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "sourceVideoUrl" TEXT,
    "duration" DOUBLE PRECISION,
    "frameCount" INTEGER NOT NULL DEFAULT 36,
    "usedTimestamps" TEXT NOT NULL DEFAULT '[]',
    "config" TEXT NOT NULL DEFAULT '{}',
    "overlayGroupIds" TEXT NOT NULL DEFAULT '[]',
    "overlayOffsetX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overlayOffsetY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "selectedCandidateId" TEXT,
    "finalCoverUrl" TEXT,
    "finalCoverKey" TEXT,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverFramePack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverFrameCandidate" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "timestamp" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverFrameCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoverFramePack_renderId_key" ON "CoverFramePack"("renderId");

-- CreateIndex
CREATE INDEX "CoverFramePack_userId_status_idx" ON "CoverFramePack"("userId", "status");

-- CreateIndex
CREATE INDEX "CoverFramePack_templateId_idx" ON "CoverFramePack"("templateId");

-- CreateIndex
CREATE INDEX "CoverFrameCandidate_packId_idx" ON "CoverFrameCandidate"("packId");

-- AddForeignKey
ALTER TABLE "CoverFramePack" ADD CONSTRAINT "CoverFramePack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverFramePack" ADD CONSTRAINT "CoverFramePack_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "Render"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverFramePack" ADD CONSTRAINT "CoverFramePack_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverFrameCandidate" ADD CONSTRAINT "CoverFrameCandidate_packId_fkey" FOREIGN KEY ("packId") REFERENCES "CoverFramePack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
