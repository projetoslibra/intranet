CREATE TYPE "RemittanceExclusionCategory" AS ENUM (
  'NOT_FOUND_IN_STOCK',
  'OPERATOR_EXCLUDED',
  'NOT_APPROVED',
  'PDD_RECOVERY',
  'OTHER_DIVERGENCE'
);

CREATE TYPE "BankDifferenceCategory" AS ENUM (
  'BANK_FEE',
  'UNIDENTIFIED_CREDIT',
  'VALUE_DIFFERENCE',
  'ROUNDING',
  'TIMING_DIFFERENCE',
  'OTHER'
);

CREATE TYPE "BankDifferenceDirection" AS ENUM (
  'ENTRY_EXCESS',
  'REMITTANCE_EXCESS'
);

CREATE TYPE "BankDifferenceStatus" AS ENUM (
  'OPEN',
  'RESOLVED',
  'CANCELLED'
);

CREATE TABLE "consignado_remittance_exclusions" (
  "id" TEXT NOT NULL,
  "remittance_id" TEXT NOT NULL,
  "settlement_item_id" TEXT NOT NULL,
  "category" "RemittanceExclusionCategory" NOT NULL,
  "reason" TEXT NOT NULL,
  "paid_amount" DECIMAL(24,2) NOT NULL,
  "title_amount" DECIMAL(24,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "consignado_remittance_exclusions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "consignado_bank_difference_titles" (
  "id" TEXT NOT NULL,
  "reconciliation_id" TEXT NOT NULL,
  "remittance_exclusion_id" TEXT NOT NULL,
  "amount" DECIMAL(24,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "consignado_bank_difference_titles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "consignado_bank_other_differences" (
  "id" TEXT NOT NULL,
  "reconciliation_id" TEXT NOT NULL,
  "created_by_user_id" TEXT NOT NULL,
  "resolved_by_user_id" TEXT,
  "category" "BankDifferenceCategory" NOT NULL,
  "direction" "BankDifferenceDirection" NOT NULL,
  "amount" DECIMAL(24,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "BankDifferenceStatus" NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "resolution_note" TEXT,
  "cancelled_at" TIMESTAMP(3),

  CONSTRAINT "consignado_bank_other_differences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "consignado_remittance_exclusions_remittance_id_settlement_item_id_key"
  ON "consignado_remittance_exclusions"("remittance_id", "settlement_item_id");

CREATE INDEX "consignado_remittance_exclusions_remittance_id_category_idx"
  ON "consignado_remittance_exclusions"("remittance_id", "category");

CREATE INDEX "consignado_remittance_exclusions_settlement_item_id_idx"
  ON "consignado_remittance_exclusions"("settlement_item_id");

CREATE UNIQUE INDEX "consignado_bank_difference_titles_reconciliation_id_remittance_exclusion_id_key"
  ON "consignado_bank_difference_titles"("reconciliation_id", "remittance_exclusion_id");

CREATE INDEX "consignado_bank_difference_titles_remittance_exclusion_id_idx"
  ON "consignado_bank_difference_titles"("remittance_exclusion_id");

CREATE INDEX "consignado_bank_other_differences_reconciliation_id_status_idx"
  ON "consignado_bank_other_differences"("reconciliation_id", "status");

CREATE INDEX "consignado_bank_other_differences_status_category_created_at_idx"
  ON "consignado_bank_other_differences"("status", "category", "created_at");

ALTER TABLE "consignado_remittance_exclusions"
  ADD CONSTRAINT "consignado_remittance_exclusions_remittance_id_fkey"
  FOREIGN KEY ("remittance_id") REFERENCES "consignado_remittances"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "consignado_remittance_exclusions"
  ADD CONSTRAINT "consignado_remittance_exclusions_settlement_item_id_fkey"
  FOREIGN KEY ("settlement_item_id") REFERENCES "consignado_settlement_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "consignado_bank_difference_titles"
  ADD CONSTRAINT "consignado_bank_difference_titles_reconciliation_id_fkey"
  FOREIGN KEY ("reconciliation_id") REFERENCES "consignado_bank_reconciliations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "consignado_bank_difference_titles"
  ADD CONSTRAINT "consignado_bank_difference_titles_remittance_exclusion_id_fkey"
  FOREIGN KEY ("remittance_exclusion_id") REFERENCES "consignado_remittance_exclusions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "consignado_bank_other_differences"
  ADD CONSTRAINT "consignado_bank_other_differences_reconciliation_id_fkey"
  FOREIGN KEY ("reconciliation_id") REFERENCES "consignado_bank_reconciliations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "consignado_bank_other_differences"
  ADD CONSTRAINT "consignado_bank_other_differences_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "consignado_bank_other_differences"
  ADD CONSTRAINT "consignado_bank_other_differences_resolved_by_user_id_fkey"
  FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "consignado_remittance_exclusions" (
  "id", "remittance_id", "settlement_item_id", "category", "reason",
  "paid_amount", "title_amount", "created_at"
)
SELECT
  'backfill_' || md5(r."id" || ':' || i."id"),
  r."id",
  i."id",
  CASE
    WHEN i."status"::text IN ('PDD_RECOVERY', 'PDD_REVIEW') THEN 'PDD_RECOVERY'::"RemittanceExclusionCategory"
    WHEN i."matched_stock_position_id" IS NULL
      AND COALESCE(i."status_reason", '') ILIKE '%não encontrado%' THEN 'NOT_FOUND_IN_STOCK'::"RemittanceExclusionCategory"
    WHEN i."exclusion_reason" IS NOT NULL
      AND i."exclusion_reason" NOT ILIKE '%não incluído na remessa aprovada%' THEN 'OPERATOR_EXCLUDED'::"RemittanceExclusionCategory"
    WHEN i."approved" = FALSE THEN 'NOT_APPROVED'::"RemittanceExclusionCategory"
    ELSE 'OTHER_DIVERGENCE'::"RemittanceExclusionCategory"
  END,
  COALESCE(i."exclusion_reason", i."status_reason", 'Não incluído na remessa.'),
  i."paid_amount",
  i."title_amount",
  r."generated_at"
FROM "consignado_remittances" r
JOIN "consignado_settlement_batches" b ON b."id" = r."batch_id"
JOIN "consignado_settlement_items" i ON i."batch_id" = b."id"
LEFT JOIN "consignado_remittance_items" ri ON ri."settlement_item_id" = i."id"
WHERE r."status"::text <> 'CANCELLED'
  AND b."status"::text <> 'CANCELLED'
  AND ri."id" IS NULL
ON CONFLICT ("remittance_id", "settlement_item_id") DO NOTHING;
