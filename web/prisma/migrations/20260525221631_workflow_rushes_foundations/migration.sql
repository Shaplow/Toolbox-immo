-- AlterTable
ALTER TABLE "ContentRecipe" ADD COLUMN     "needsBrief" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "needsRushes" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PublicationVersion" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PublicationBrief" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "body" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "PublicationBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationBriefAttachment" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationBriefAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationRush" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "uploadedByUserId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PublicationRush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationBrief_slotId_key" ON "PublicationBrief"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationBriefAttachment_r2Key_key" ON "PublicationBriefAttachment"("r2Key");

-- CreateIndex
CREATE INDEX "PublicationBriefAttachment_briefId_idx" ON "PublicationBriefAttachment"("briefId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationRush_r2Key_key" ON "PublicationRush"("r2Key");

-- CreateIndex
CREATE INDEX "PublicationRush_slotId_deletedAt_idx" ON "PublicationRush"("slotId", "deletedAt");

-- CreateIndex
CREATE INDEX "PublicationVersion_slotId_deletedAt_idx" ON "PublicationVersion"("slotId", "deletedAt");

-- AddForeignKey
ALTER TABLE "PublicationBrief" ADD CONSTRAINT "PublicationBrief_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "PublicationSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationBrief" ADD CONSTRAINT "PublicationBrief_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationBriefAttachment" ADD CONSTRAINT "PublicationBriefAttachment_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "PublicationBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationRush" ADD CONSTRAINT "PublicationRush_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "PublicationSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationRush" ADD CONSTRAINT "PublicationRush_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
