-- AlterTable: add segmentTextOverrides column to DerushJob
ALTER TABLE "DerushJob" ADD COLUMN "segmentTextOverrides" TEXT NOT NULL DEFAULT '{}';
