ALTER TYPE "SettlementItemStatus" ADD VALUE IF NOT EXISTS 'PDD_RECOVERY';
ALTER TYPE "SettlementItemStatus" ADD VALUE IF NOT EXISTS 'PDD_REVIEW';

CREATE TABLE "consignado_pdd_imports" (
    "id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "imported_by_user_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consignado_pdd_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "consignado_pdd_titles" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "source_row" INTEGER NOT NULL,
    "row_hash" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3),
    "remittance_file" TEXT,
    "audit_file" TEXT,
    "flow_source" TEXT,
    "originator" TEXT,
    "debtor_name" TEXT,
    "debtor_document" TEXT,
    "cedent_name" TEXT,
    "document_number" TEXT,
    "your_number_used" TEXT,
    "your_number_original" TEXT,
    "cnab_document_number" TEXT,
    "stock_your_number" TEXT,
    "stock_document_number" TEXT,
    "nominal_value" DECIMAL(24,2),
    "present_value" DECIMAL(24,2),
    "acquisition_value" DECIMAL(24,2),
    "pdd_value" DECIMAL(24,2),
    "due_date" DATE,
    "acquisition_date" DATE,
    "pdd_range" TEXT,
    "receivable_situation" TEXT,
    "write_off_type" TEXT,
    "occurrence" TEXT,
    "control_status" TEXT,
    "history_status" TEXT,
    "relationship_status" TEXT,
    "current_stock_status" TEXT,
    "pdd_line" TEXT,
    "source_lines" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consignado_pdd_titles_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "consignado_settlement_items" ADD COLUMN "matched_pdd_title_id" TEXT;

CREATE UNIQUE INDEX "consignado_pdd_imports_fund_id_file_hash_key" ON "consignado_pdd_imports"("fund_id", "file_hash");
CREATE INDEX "consignado_pdd_imports_fund_id_created_at_idx" ON "consignado_pdd_imports"("fund_id", "created_at");
CREATE UNIQUE INDEX "consignado_pdd_titles_row_hash_key" ON "consignado_pdd_titles"("row_hash");
CREATE UNIQUE INDEX "consignado_pdd_titles_import_id_source_row_key" ON "consignado_pdd_titles"("import_id", "source_row");
CREATE INDEX "consignado_pdd_titles_fund_id_debtor_document_your_number_used_idx" ON "consignado_pdd_titles"("fund_id", "debtor_document", "your_number_used");
CREATE INDEX "consignado_pdd_titles_fund_id_debtor_document_document_number_idx" ON "consignado_pdd_titles"("fund_id", "debtor_document", "document_number");
CREATE INDEX "consignado_pdd_titles_fund_id_debtor_document_due_date_nominal_value_idx" ON "consignado_pdd_titles"("fund_id", "debtor_document", "due_date", "nominal_value");
CREATE INDEX "consignado_settlement_items_matched_pdd_title_id_idx" ON "consignado_settlement_items"("matched_pdd_title_id");

ALTER TABLE "consignado_pdd_imports" ADD CONSTRAINT "consignado_pdd_imports_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consignado_pdd_imports" ADD CONSTRAINT "consignado_pdd_imports_imported_by_user_id_fkey" FOREIGN KEY ("imported_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consignado_pdd_titles" ADD CONSTRAINT "consignado_pdd_titles_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "consignado_pdd_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consignado_pdd_titles" ADD CONSTRAINT "consignado_pdd_titles_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consignado_settlement_items" ADD CONSTRAINT "consignado_settlement_items_matched_pdd_title_id_fkey" FOREIGN KEY ("matched_pdd_title_id") REFERENCES "consignado_pdd_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
