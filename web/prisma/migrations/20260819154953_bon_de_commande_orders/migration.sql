-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "validationStatus" TEXT;

-- AlterTable
ALTER TABLE "EntityType" ADD COLUMN     "needsAdminValidation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "needsClientValidation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PublicationSlot" ADD COLUMN     "orderId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clientId" TEXT;

-- CreateTable
CREATE TABLE "OrderTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTemplateItem" (
    "id" TEXT NOT NULL,
    "orderTemplateId" TEXT NOT NULL,
    "entityTypeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTemplateRecipe" (
    "id" TEXT NOT NULL,
    "orderTemplateId" TEXT NOT NULL,
    "patternTemplateId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "OrderTemplateRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTemplateAccess" (
    "id" TEXT NOT NULL,
    "orderTemplateId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "OrderTemplateAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderTemplateId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "accountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "rejectedReason" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "validatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderTemplateItem_orderTemplateId_idx" ON "OrderTemplateItem"("orderTemplateId");

-- CreateIndex
CREATE INDEX "OrderTemplateRecipe_orderTemplateId_idx" ON "OrderTemplateRecipe"("orderTemplateId");

-- CreateIndex
CREATE INDEX "OrderTemplateAccess_clientId_idx" ON "OrderTemplateAccess"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTemplateAccess_orderTemplateId_clientId_key" ON "OrderTemplateAccess"("orderTemplateId", "clientId");

-- CreateIndex
CREATE INDEX "Order_clientId_status_idx" ON "Order"("clientId", "status");

-- CreateIndex
CREATE INDEX "Order_orderTemplateId_idx" ON "Order"("orderTemplateId");

-- CreateIndex
CREATE INDEX "Entity_orderId_idx" ON "Entity"("orderId");

-- CreateIndex
CREATE INDEX "PublicationSlot_orderId_idx" ON "PublicationSlot"("orderId");

-- CreateIndex
CREATE INDEX "User_clientId_idx" ON "User"("clientId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationSlot" ADD CONSTRAINT "PublicationSlot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateItem" ADD CONSTRAINT "OrderTemplateItem_orderTemplateId_fkey" FOREIGN KEY ("orderTemplateId") REFERENCES "OrderTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateItem" ADD CONSTRAINT "OrderTemplateItem_entityTypeId_fkey" FOREIGN KEY ("entityTypeId") REFERENCES "EntityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateRecipe" ADD CONSTRAINT "OrderTemplateRecipe_orderTemplateId_fkey" FOREIGN KEY ("orderTemplateId") REFERENCES "OrderTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateRecipe" ADD CONSTRAINT "OrderTemplateRecipe_patternTemplateId_fkey" FOREIGN KEY ("patternTemplateId") REFERENCES "PatternTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateAccess" ADD CONSTRAINT "OrderTemplateAccess_orderTemplateId_fkey" FOREIGN KEY ("orderTemplateId") REFERENCES "OrderTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateAccess" ADD CONSTRAINT "OrderTemplateAccess_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_orderTemplateId_fkey" FOREIGN KEY ("orderTemplateId") REFERENCES "OrderTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
