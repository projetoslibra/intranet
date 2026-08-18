ALTER TABLE "consignado_bank_credit_entries"
  ADD COLUMN "adjusted_amount" DECIMAL(24,2) NOT NULL DEFAULT 0;

ALTER TABLE "consignado_remittances"
  ADD COLUMN "adjusted_amount" DECIMAL(24,2) NOT NULL DEFAULT 0;

ALTER TABLE "consignado_bank_reconciliations"
  ADD COLUMN "entry_total_amount" DECIMAL(24,2) NOT NULL DEFAULT 0,
  ADD COLUMN "remittance_total_amount" DECIMAL(24,2) NOT NULL DEFAULT 0,
  ADD COLUMN "difference_amount" DECIMAL(24,2) NOT NULL DEFAULT 0,
  ADD COLUMN "difference_reason" TEXT;

UPDATE "consignado_bank_reconciliations"
SET
  "entry_total_amount" = "total_amount",
  "remittance_total_amount" = "total_amount";

CREATE TABLE "consignado_bank_adjustments" (
  "id" TEXT NOT NULL,
  "reconciliation_id" TEXT NOT NULL,
  "bank_entry_id" TEXT,
  "remittance_id" TEXT,
  "amount" DECIMAL(24,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "consignado_bank_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consignado_bank_adjustments_single_side_check" CHECK (
    ("bank_entry_id" IS NOT NULL AND "remittance_id" IS NULL)
    OR ("bank_entry_id" IS NULL AND "remittance_id" IS NOT NULL)
  )
);

CREATE INDEX "consignado_bank_adjustments_reconciliation_id_idx"
  ON "consignado_bank_adjustments"("reconciliation_id");

CREATE INDEX "consignado_bank_adjustments_bank_entry_id_idx"
  ON "consignado_bank_adjustments"("bank_entry_id");

CREATE INDEX "consignado_bank_adjustments_remittance_id_idx"
  ON "consignado_bank_adjustments"("remittance_id");

ALTER TABLE "consignado_bank_adjustments"
  ADD CONSTRAINT "consignado_bank_adjustments_reconciliation_id_fkey"
  FOREIGN KEY ("reconciliation_id") REFERENCES "consignado_bank_reconciliations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "consignado_bank_adjustments"
  ADD CONSTRAINT "consignado_bank_adjustments_bank_entry_id_fkey"
  FOREIGN KEY ("bank_entry_id") REFERENCES "consignado_bank_credit_entries"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "consignado_bank_adjustments"
  ADD CONSTRAINT "consignado_bank_adjustments_remittance_id_fkey"
  FOREIGN KEY ("remittance_id") REFERENCES "consignado_remittances"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
