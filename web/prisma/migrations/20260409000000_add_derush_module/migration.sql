-- CreateTable: DerushPreset
CREATE TABLE "DerushPreset" (
    "id"           TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "userId"       TEXT,
    "isBuiltin"    BOOLEAN NOT NULL DEFAULT false,
    "analysisMode" TEXT NOT NULL DEFAULT 'vision',
    "config"       TEXT NOT NULL DEFAULT '{}',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DerushPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DerushPresetAccess
CREATE TABLE "DerushPresetAccess" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "presetId"  TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DerushPresetAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DerushJob
CREATE TABLE "DerushJob" (
    "id"                     TEXT NOT NULL,
    "userId"                 TEXT NOT NULL,
    "status"                 TEXT NOT NULL DEFAULT 'QUEUED',
    "analysisMode"           TEXT NOT NULL DEFAULT 'vision',
    "inputFiles"             TEXT NOT NULL DEFAULT '[]',
    "transcriptionJobId"     TEXT,
    "transcriptionInputKey"  TEXT,
    "presetId"               TEXT,
    "visionProvider"         TEXT NOT NULL DEFAULT 'heuristic',
    "runpodJobId"            TEXT,
    "outputJsonKey"          TEXT,
    "segmentCount"           INTEGER,
    "totalDuration"          DOUBLE PRECISION,
    "errorMsg"               TEXT,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DerushJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DerushExport
CREATE TABLE "DerushExport" (
    "id"             TEXT NOT NULL,
    "derushJobId"    TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'QUEUED',
    "exportFormat"   TEXT NOT NULL,
    "workflow"       TEXT,
    "comboFormats"   TEXT NOT NULL DEFAULT '[]',
    "accurateTrim"   BOOLEAN NOT NULL DEFAULT false,
    "outputKey"      TEXT,
    "outputFilename" TEXT,
    "runpodJobId"    TEXT,
    "errorMsg"       TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DerushExport_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex: DerushPresetAccess
CREATE UNIQUE INDEX "DerushPresetAccess_userId_presetId_key"
    ON "DerushPresetAccess"("userId", "presetId");

-- AddForeignKey: DerushPreset.userId -> User
ALTER TABLE "DerushPreset"
    ADD CONSTRAINT "DerushPreset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DerushPresetAccess.userId -> User
ALTER TABLE "DerushPresetAccess"
    ADD CONSTRAINT "DerushPresetAccess_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DerushPresetAccess.presetId -> DerushPreset
ALTER TABLE "DerushPresetAccess"
    ADD CONSTRAINT "DerushPresetAccess_presetId_fkey"
    FOREIGN KEY ("presetId") REFERENCES "DerushPreset"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DerushJob.userId -> User
ALTER TABLE "DerushJob"
    ADD CONSTRAINT "DerushJob_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DerushJob.presetId -> DerushPreset
ALTER TABLE "DerushJob"
    ADD CONSTRAINT "DerushJob_presetId_fkey"
    FOREIGN KEY ("presetId") REFERENCES "DerushPreset"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: DerushExport.derushJobId -> DerushJob
ALTER TABLE "DerushExport"
    ADD CONSTRAINT "DerushExport_derushJobId_fkey"
    FOREIGN KEY ("derushJobId") REFERENCES "DerushJob"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
