-- Add unique constraint on DerushJob.runpodJobId
-- RunPod assigns a unique job ID per submission; enforcing this at DB level
-- prevents duplicate webhook deliveries from updating the wrong row and
-- allows us to use findUnique instead of findFirst in webhook handlers.
CREATE UNIQUE INDEX IF NOT EXISTS "DerushJob_runpodJobId_key" ON "DerushJob"("runpodJobId");

-- Add unique constraint on DerushExport.runpodJobId
CREATE UNIQUE INDEX IF NOT EXISTS "DerushExport_runpodJobId_key" ON "DerushExport"("runpodJobId");
