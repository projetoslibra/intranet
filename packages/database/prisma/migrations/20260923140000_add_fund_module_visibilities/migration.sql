CREATE TYPE "FundModule" AS ENUM ('DASHBOARD', 'CASH', 'DRE', 'FORECASTS', 'PDD');

CREATE TABLE "fund_module_visibilities" (
    "fund_id" TEXT NOT NULL,
    "module" "FundModule" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_user_id" TEXT,

    CONSTRAINT "fund_module_visibilities_pkey" PRIMARY KEY ("fund_id", "module")
);

CREATE INDEX "fund_module_visibilities_module_enabled_idx"
    ON "fund_module_visibilities"("module", "enabled");

CREATE INDEX "fund_module_visibilities_updated_by_user_id_idx"
    ON "fund_module_visibilities"("updated_by_user_id");

ALTER TABLE "fund_module_visibilities"
    ADD CONSTRAINT "fund_module_visibilities_fund_id_fkey"
    FOREIGN KEY ("fund_id") REFERENCES "funds"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fund_module_visibilities"
    ADD CONSTRAINT "fund_module_visibilities_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "fund_module_visibilities" (
    "fund_id",
    "module",
    "enabled",
    "updated_at"
)
SELECT
    fund."id",
    modules."module",
    fund."status" = 'ACTIVE'::"FundStatus",
    CURRENT_TIMESTAMP
FROM "funds" AS fund
CROSS JOIN (
    VALUES
        ('DASHBOARD'::"FundModule"),
        ('CASH'::"FundModule"),
        ('DRE'::"FundModule"),
        ('FORECASTS'::"FundModule"),
        ('PDD'::"FundModule")
) AS modules("module")
ON CONFLICT ("fund_id", "module") DO UPDATE
SET
    "enabled" = EXCLUDED."enabled",
    "updated_at" = CURRENT_TIMESTAMP;

UPDATE "funds"
SET "status" = 'ACTIVE'::"FundStatus"
WHERE UPPER(COALESCE("shortName", '') || ' ' || COALESCE("name", ''))
    LIKE ANY (ARRAY['%APUAMA%', '%BRISTOL%', '%ANTENA%']);

UPDATE "funds"
SET "status" = 'INACTIVE'::"FundStatus"
WHERE UPPER(COALESCE("shortName", '') || ' ' || COALESCE("name", '')) LIKE '%CONSIGNADO%';

UPDATE "fund_module_visibilities" AS visibility
SET "enabled" = true, "updated_at" = CURRENT_TIMESTAMP
FROM "funds" AS fund
WHERE visibility."fund_id" = fund."id"
  AND UPPER(COALESCE(fund."shortName", '') || ' ' || COALESCE(fund."name", ''))
      LIKE ANY (ARRAY['%APUAMA%', '%BRISTOL%']);

UPDATE "fund_module_visibilities" AS visibility
SET
    "enabled" = visibility."module" = 'CASH'::"FundModule",
    "updated_at" = CURRENT_TIMESTAMP
FROM "funds" AS fund
WHERE visibility."fund_id" = fund."id"
  AND UPPER(COALESCE(fund."shortName", '') || ' ' || COALESCE(fund."name", '')) LIKE '%ANTENA%';

UPDATE "fund_module_visibilities" AS visibility
SET "enabled" = false, "updated_at" = CURRENT_TIMESTAMP
FROM "funds" AS fund
WHERE visibility."fund_id" = fund."id"
  AND UPPER(COALESCE(fund."shortName", '') || ' ' || COALESCE(fund."name", '')) LIKE '%CONSIGNADO%';
