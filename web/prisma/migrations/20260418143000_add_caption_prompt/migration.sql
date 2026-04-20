-- CreateTable
CREATE TABLE "CaptionPrompt" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "autoHighlightEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoHighlightMode" TEXT NOT NULL DEFAULT 'highlight1',
    "autoHighlightPlacement" TEXT NOT NULL DEFAULT 'after',
    "autoHighlightPrompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptionPrompt_pkey" PRIMARY KEY ("id")
);