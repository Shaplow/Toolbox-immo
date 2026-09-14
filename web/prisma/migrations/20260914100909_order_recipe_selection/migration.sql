-- AlterTable
ALTER TABLE "OrderTemplateRecipe" ADD COLUMN     "defaultSelected" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isOptional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OrderRecipeSelection" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "patternTemplateId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "OrderRecipeSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderRecipeSelection_orderId_idx" ON "OrderRecipeSelection"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRecipeSelection_orderId_patternTemplateId_key" ON "OrderRecipeSelection"("orderId", "patternTemplateId");

-- AddForeignKey
ALTER TABLE "OrderRecipeSelection" ADD CONSTRAINT "OrderRecipeSelection_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRecipeSelection" ADD CONSTRAINT "OrderRecipeSelection_patternTemplateId_fkey" FOREIGN KEY ("patternTemplateId") REFERENCES "PatternTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
