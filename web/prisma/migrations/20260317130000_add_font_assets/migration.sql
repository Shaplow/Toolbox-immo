CREATE TABLE "FontAsset" (
    "id" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageKey" TEXT,
    "originalName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FontAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FontAsset_family_key" ON "FontAsset"("family");