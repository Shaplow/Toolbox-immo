-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Offer_name_key" ON "Offer"("name");

-- Seed default offers
INSERT INTO "Offer" ("id", "name", "createdAt")
VALUES
    (gen_random_uuid()::text, 'ESSENTIEL', NOW()),
    (gen_random_uuid()::text, 'CONFIRME', NOW()),
    (gen_random_uuid()::text, 'CEO', NOW()),
    (gen_random_uuid()::text, 'COMPTE_AGENCE', NOW())
ON CONFLICT ("name") DO NOTHING;
