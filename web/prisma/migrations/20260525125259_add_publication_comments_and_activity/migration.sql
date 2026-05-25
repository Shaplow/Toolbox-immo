-- CreateTable
CREATE TABLE "PublicationComment" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PublicationComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationActivity" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicationComment_slotId_createdAt_idx" ON "PublicationComment"("slotId", "createdAt");

-- CreateIndex
CREATE INDEX "PublicationActivity_slotId_createdAt_idx" ON "PublicationActivity"("slotId", "createdAt");

-- AddForeignKey
ALTER TABLE "PublicationComment" ADD CONSTRAINT "PublicationComment_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "PublicationSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationComment" ADD CONSTRAINT "PublicationComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationActivity" ADD CONSTRAINT "PublicationActivity_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "PublicationSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationActivity" ADD CONSTRAINT "PublicationActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
