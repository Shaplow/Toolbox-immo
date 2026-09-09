-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "videasteConfirmation" TEXT,
ADD COLUMN     "videasteConfirmationAt" TIMESTAMP(3),
ADD COLUMN     "videasteDeclineReason" TEXT;
