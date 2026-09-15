-- CreateTable
CREATE TABLE "EntityBriefAttachment" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityBriefAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EntityBriefAttachment_r2Key_key" ON "EntityBriefAttachment"("r2Key");

-- CreateIndex
CREATE INDEX "EntityBriefAttachment_entityId_idx" ON "EntityBriefAttachment"("entityId");

-- AddForeignKey
ALTER TABLE "EntityBriefAttachment" ADD CONSTRAINT "EntityBriefAttachment_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
