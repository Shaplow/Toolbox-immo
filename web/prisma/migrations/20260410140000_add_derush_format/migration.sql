-- CreateTable
CREATE TABLE "DerushFormat" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "contextPrompt" TEXT NOT NULL DEFAULT '',
    "silenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "exportMode" TEXT NOT NULL DEFAULT 'individual',
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DerushFormat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DerushFormat_slug_key" ON "DerushFormat"("slug");

-- AddForeignKey
ALTER TABLE "DerushFormat" ADD CONSTRAINT "DerushFormat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "DerushJob" ADD COLUMN "formatId" TEXT;
ALTER TABLE "DerushJob" ADD COLUMN "enableDiarization" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "DerushJob" ADD CONSTRAINT "DerushJob_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "DerushFormat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
