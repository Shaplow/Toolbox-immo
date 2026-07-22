-- AlterTable
ALTER TABLE "PublicationSlot" ADD COLUMN     "eventId" TEXT;

-- AlterTable
ALTER TABLE "PublicationRush" ADD COLUMN     "eventId" TEXT,
ALTER COLUMN "slotId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ShootEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "shotAt" TIMESTAMP(3),
    "assigneeVideasteId" TEXT,
    "defaultAssigneeMonteurId" TEXT,
    "defaultAssigneeCmId" TEXT,
    "notes" TEXT,
    "brief" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShootEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShootEventActivity" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShootEventActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShootEvent_accountId_scheduledAt_idx" ON "ShootEvent"("accountId", "scheduledAt");

-- CreateIndex
CREATE INDEX "ShootEvent_status_scheduledAt_idx" ON "ShootEvent"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ShootEvent_assigneeVideasteId_idx" ON "ShootEvent"("assigneeVideasteId");

-- CreateIndex
CREATE INDEX "ShootEvent_propertyId_idx" ON "ShootEvent"("propertyId");

-- CreateIndex
CREATE INDEX "ShootEventActivity_eventId_createdAt_idx" ON "ShootEventActivity"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "PublicationSlot_eventId_idx" ON "PublicationSlot"("eventId");

-- CreateIndex
CREATE INDEX "PublicationRush_eventId_deletedAt_idx" ON "PublicationRush"("eventId", "deletedAt");

-- AddForeignKey
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ShootEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootEvent" ADD CONSTRAINT "ShootEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootEvent" ADD CONSTRAINT "ShootEvent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootEvent" ADD CONSTRAINT "ShootEvent_assigneeVideasteId_fkey" FOREIGN KEY ("assigneeVideasteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootEvent" ADD CONSTRAINT "ShootEvent_defaultAssigneeMonteurId_fkey" FOREIGN KEY ("defaultAssigneeMonteurId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootEvent" ADD CONSTRAINT "ShootEvent_defaultAssigneeCmId_fkey" FOREIGN KEY ("defaultAssigneeCmId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootEvent" ADD CONSTRAINT "ShootEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootEventActivity" ADD CONSTRAINT "ShootEventActivity_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ShootEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShootEventActivity" ADD CONSTRAINT "ShootEventActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationRush" ADD CONSTRAINT "PublicationRush_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ShootEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

