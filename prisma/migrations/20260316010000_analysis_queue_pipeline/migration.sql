DO $$ BEGIN
    CREATE TYPE "AnalysisStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Analysis"
    ADD COLUMN IF NOT EXISTS "jobId" TEXT,
    ADD COLUMN IF NOT EXISTS "assetClass" TEXT,
    ADD COLUMN IF NOT EXISTS "status" "AnalysisStatus" NOT NULL DEFAULT 'QUEUED',
    ADD COLUMN IF NOT EXISTS "progress" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "currentStage" TEXT,
    ADD COLUMN IF NOT EXISTS "tp1" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "tp2" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "explanation" TEXT,
    ADD COLUMN IF NOT EXISTS "layer1Output" JSONB,
    ADD COLUMN IF NOT EXISTS "layer2Output" JSONB,
    ADD COLUMN IF NOT EXISTS "errorMessage" TEXT,
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Analysis"
SET "jobId" = "id"
WHERE "jobId" IS NULL;

DO $$
BEGIN
    ALTER TABLE "Analysis"
    ALTER COLUMN "entry" TYPE DOUBLE PRECISION
    USING CASE
        WHEN "entry" IS NULL THEN NULL
        WHEN "entry" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN "entry"::DOUBLE PRECISION
        ELSE NULL
    END;
EXCEPTION
    WHEN undefined_column THEN null;
END $$;

DO $$
BEGIN
    ALTER TABLE "Analysis"
    ALTER COLUMN "stopLoss" TYPE DOUBLE PRECISION
    USING CASE
        WHEN "stopLoss" IS NULL THEN NULL
        WHEN "stopLoss" ~ '^-?[0-9]+(\.[0-9]+)?$' THEN "stopLoss"::DOUBLE PRECISION
        ELSE NULL
    END;
EXCEPTION
    WHEN undefined_column THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Analysis_jobId_key" ON "Analysis"("jobId");