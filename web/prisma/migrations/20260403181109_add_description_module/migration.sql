-- CreateTable
CREATE TABLE "DescriptionPrompt" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DescriptionPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DescriptionJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "inputType" TEXT NOT NULL DEFAULT 'upload',
    "inputFilename" TEXT,
    "transcriptionId" TEXT,
    "promptId" TEXT,
    "promptSnapshot" TEXT,
    "personalization" TEXT,
    "model" TEXT NOT NULL DEFAULT 'claude',
    "result" TEXT,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DescriptionJob_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DescriptionJob" ADD CONSTRAINT "DescriptionJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DescriptionJob" ADD CONSTRAINT "DescriptionJob_transcriptionId_fkey" FOREIGN KEY ("transcriptionId") REFERENCES "TranscriptionJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DescriptionJob" ADD CONSTRAINT "DescriptionJob_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "DescriptionPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
