-- CreateTable
CREATE TABLE "PublicationSlotCollab" (
    "slotId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationSlotCollab_slotId_accountId_key" ON "PublicationSlotCollab"("slotId", "accountId");

-- CreateIndex
CREATE INDEX "PublicationSlotCollab_accountId_idx" ON "PublicationSlotCollab"("accountId");

-- AddForeignKey
ALTER TABLE "PublicationSlotCollab" ADD CONSTRAINT "PublicationSlotCollab_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "PublicationSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationSlotCollab" ADD CONSTRAINT "PublicationSlotCollab_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
