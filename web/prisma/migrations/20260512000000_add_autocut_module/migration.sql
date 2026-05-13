-- CreateTable
CREATE TABLE "MediaAutocutBatch" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "doneCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "runpodId" TEXT,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAutocutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAutocutJob" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "batchId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proposedStart" DOUBLE PRECISION,
    "proposedEnd" DOUBLE PRECISION,
    "transcriptJson" TEXT,
    "language" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending_review',
    "confirmedStart" DOUBLE PRECISION,
    "confirmedEnd" DOUBLE PRECISION,
    "editJobId" TEXT,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAutocutJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAutocutBatch_runpodId_key" ON "MediaAutocutBatch"("runpodId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAutocutJob_editJobId_key" ON "MediaAutocutJob"("editJobId");

-- AddForeignKey
ALTER TABLE "MediaAutocutBatch" ADD CONSTRAINT "MediaAutocutBatch_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "MediaLibrary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAutocutJob" ADD CONSTRAINT "MediaAutocutJob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAutocutJob" ADD CONSTRAINT "MediaAutocutJob_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "MediaLibrary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAutocutJob" ADD CONSTRAINT "MediaAutocutJob_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MediaAutocutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAutocutJob" ADD CONSTRAINT "MediaAutocutJob_editJobId_fkey" FOREIGN KEY ("editJobId") REFERENCES "MediaEditJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
