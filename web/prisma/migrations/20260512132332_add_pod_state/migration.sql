-- DropIndex
DROP INDEX "DerushExport_runpodJobId_key";

-- DropIndex
DROP INDEX "DerushJob_runpodJobId_key";

-- CreateTable
CREATE TABLE "PodState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "status" TEXT NOT NULL DEFAULT 'stopped',
    "podUrl" TEXT,
    "lastJobAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PodState_pkey" PRIMARY KEY ("id")
);
