/*
  Warnings:

  - You are about to drop the `DerushExport` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DerushFormat` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DerushJob` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DerushPreset` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DerushPresetAccess` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "DerushExport" DROP CONSTRAINT "DerushExport_derushJobId_fkey";

-- DropForeignKey
ALTER TABLE "DerushFormat" DROP CONSTRAINT "DerushFormat_userId_fkey";

-- DropForeignKey
ALTER TABLE "DerushJob" DROP CONSTRAINT "DerushJob_formatId_fkey";

-- DropForeignKey
ALTER TABLE "DerushJob" DROP CONSTRAINT "DerushJob_presetId_fkey";

-- DropForeignKey
ALTER TABLE "DerushJob" DROP CONSTRAINT "DerushJob_userId_fkey";

-- DropForeignKey
ALTER TABLE "DerushPreset" DROP CONSTRAINT "DerushPreset_userId_fkey";

-- DropForeignKey
ALTER TABLE "DerushPresetAccess" DROP CONSTRAINT "DerushPresetAccess_presetId_fkey";

-- DropForeignKey
ALTER TABLE "DerushPresetAccess" DROP CONSTRAINT "DerushPresetAccess_userId_fkey";

-- DropTable
DROP TABLE "DerushExport";

-- DropTable
DROP TABLE "DerushFormat";

-- DropTable
DROP TABLE "DerushJob";

-- DropTable
DROP TABLE "DerushPreset";

-- DropTable
DROP TABLE "DerushPresetAccess";
