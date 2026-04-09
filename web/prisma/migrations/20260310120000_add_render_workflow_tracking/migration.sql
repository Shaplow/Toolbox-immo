-- Render workflow tracking for image/video generation observability
ALTER TABLE "Render"
ADD COLUMN     "pipeline" TEXT,
ADD COLUMN     "stage" TEXT,
ADD COLUMN     "statusDetail" TEXT,
ADD COLUMN     "progress" DOUBLE PRECISION,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3);