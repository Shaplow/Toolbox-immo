-- AlterTable: DerushExport — add xmlFormat column
ALTER TABLE "DerushExport"
    ADD COLUMN "xmlFormat" TEXT NOT NULL DEFAULT 'fcpxml';
