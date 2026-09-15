-- CreateTable
CREATE TABLE "OrderTemplateItemShootType" (
    "id" TEXT NOT NULL,
    "orderTemplateItemId" TEXT NOT NULL,
    "shootTypeId" TEXT NOT NULL,

    CONSTRAINT "OrderTemplateItemShootType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderTemplateItemShootType_shootTypeId_idx" ON "OrderTemplateItemShootType"("shootTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTemplateItemShootType_orderTemplateItemId_shootTypeId_key" ON "OrderTemplateItemShootType"("orderTemplateItemId", "shootTypeId");

-- AddForeignKey
ALTER TABLE "OrderTemplateItemShootType" ADD CONSTRAINT "OrderTemplateItemShootType_orderTemplateItemId_fkey" FOREIGN KEY ("orderTemplateItemId") REFERENCES "OrderTemplateItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateItemShootType" ADD CONSTRAINT "OrderTemplateItemShootType_shootTypeId_fkey" FOREIGN KEY ("shootTypeId") REFERENCES "OrderTemplateShootType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
