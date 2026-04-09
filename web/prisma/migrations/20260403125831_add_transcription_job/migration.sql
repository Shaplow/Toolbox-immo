-- CreateTable
CREATE TABLE "TranscriptionJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "inputKey" TEXT,
    "inputFilename" TEXT,
    "model" TEXT NOT NULL DEFAULT 'turbo',
    "language" TEXT NOT NULL DEFAULT 'fr',
    "enableDiarization" BOOLEAN NOT NULL DEFAULT false,
    "hasDiarization" BOOLEAN NOT NULL DEFAULT false,
    "runpodJobId" TEXT,
    "outputJsonKey" TEXT,
    "segmentCount" INTEGER,
    "duration" DOUBLE PRECISION,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptionJob_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TranscriptionJob" ADD CONSTRAINT "TranscriptionJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
