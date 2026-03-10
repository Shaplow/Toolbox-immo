-- CreateTable
CREATE TABLE "CaptionPresetAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptionPresetAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaptionPresetAccess_userId_presetId_key" ON "CaptionPresetAccess"("userId", "presetId");

-- AddForeignKey
ALTER TABLE "CaptionPresetAccess" ADD CONSTRAINT "CaptionPresetAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptionPresetAccess" ADD CONSTRAINT "CaptionPresetAccess_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "CaptionPreset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
