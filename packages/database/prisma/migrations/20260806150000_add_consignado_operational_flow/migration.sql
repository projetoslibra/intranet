-- CreateEnum
CREATE TYPE "OperationalFlowSource" AS ENUM ('BMP', 'UY3');

-- CreateEnum
CREATE TYPE "OperationalOriginatorCode" AS ENUM ('GIBB', 'JUCA', 'BANKERIZE', 'UY3');

-- CreateEnum
CREATE TYPE "SettlementBatchStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'REVIEW_REQUIRED', 'READY', 'APPROVED', 'GENERATED', 'RECONCILING', 'RECONCILED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "SettlementItemStatus" AS ENUM ('FULL_MATCH', 'PARTIAL_MATCH', 'NOT_FOUND', 'AMBIGUOUS', 'DIVERGENT', 'DUPLICATE', 'MANUALLY_MATCHED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "RemittanceStatus" AS ENUM ('GENERATED', 'RECONCILING', 'RECONCILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockReconciliationStatus" AS ENUM ('AWAITING_NEXT_STOCK', 'CONFIRMED', 'STILL_IN_STOCK', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "BankEntryStatus" AS ENUM ('PENDING', 'PARTIAL', 'RECONCILED');

-- CreateEnum
CREATE TYPE "BankReconciliationStatus" AS ENUM ('ACTIVE', 'UNDONE');

-- CreateTable
CREATE TABLE "consignado_originators" (
    "id" TEXT NOT NULL,
    "code" "OperationalOriginatorCode" NOT NULL,
    "name" TEXT NOT NULL,
    "source" "OperationalFlowSource" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consignado_originators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignado_settlement_batches" (
    "id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "stock_batch_id" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "originator_id" TEXT,
    "source" "OperationalFlowSource" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "storage_key" TEXT,
    "reference_date" DATE NOT NULL,
    "status" "SettlementBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "full_items" INTEGER NOT NULL DEFAULT 0,
    "partial_items" INTEGER NOT NULL DEFAULT 0,
    "issue_items" INTEGER NOT NULL DEFAULT 0,
    "received_amount" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "matched_amount" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "excluded_amount" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "consignado_settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignado_settlement_items" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "source_row" INTEGER NOT NULL,
    "source_raw" TEXT,
    "occurrence" TEXT,
    "contract_number" TEXT,
    "installment_number" TEXT,
    "your_number" TEXT,
    "document_number" TEXT,
    "debtor_name" TEXT,
    "debtor_document" TEXT,
    "due_date" DATE,
    "title_amount" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "status" "SettlementItemStatus" NOT NULL,
    "status_reason" TEXT,
    "matched_stock_position_id" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "exclusion_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consignado_settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignado_manual_corrections" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "replacement_position_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "previous_position_id" TEXT,
    "original_your_number" TEXT,
    "replacement_your_number" TEXT,
    "justification" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consignado_manual_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignado_remittances" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "generated_by_user_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "status" "RemittanceStatus" NOT NULL DEFAULT 'GENERATED',
    "stock_status" "StockReconciliationStatus" NOT NULL DEFAULT 'AWAITING_NEXT_STOCK',
    "total_items" INTEGER NOT NULL,
    "total_amount" DECIMAL(24,2) NOT NULL,
    "allocated_amount" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_stock_batch_id" TEXT,
    "checked_at" TIMESTAMP(3),

    CONSTRAINT "consignado_remittances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignado_remittance_items" (
    "id" TEXT NOT NULL,
    "remittance_id" TEXT NOT NULL,
    "settlement_item_id" TEXT NOT NULL,
    "stock_position_id" TEXT NOT NULL,
    "your_number" TEXT,
    "document_number" TEXT,
    "debtor_document" TEXT,
    "amount" DECIMAL(24,2) NOT NULL,
    "occurrence" TEXT NOT NULL,
    "stock_status" "StockReconciliationStatus" NOT NULL DEFAULT 'AWAITING_NEXT_STOCK',
    "checked_at" TIMESTAMP(3),

    CONSTRAINT "consignado_remittance_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignado_bank_statement_imports" (
    "id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "imported_by_user_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "agency" TEXT,
    "account" TEXT,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "ignored_rows" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consignado_bank_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignado_bank_credit_entries" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "transaction_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "document" TEXT,
    "amount" DECIMAL(24,2) NOT NULL,
    "allocated_amount" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "fingerprint" TEXT NOT NULL,
    "status" "BankEntryStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consignado_bank_credit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignado_bank_reconciliations" (
    "id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "undone_by_user_id" TEXT,
    "status" "BankReconciliationStatus" NOT NULL DEFAULT 'ACTIVE',
    "total_amount" DECIMAL(24,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" TIMESTAMP(3),

    CONSTRAINT "consignado_bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignado_bank_allocations" (
    "id" TEXT NOT NULL,
    "reconciliation_id" TEXT NOT NULL,
    "bank_entry_id" TEXT NOT NULL,
    "remittance_id" TEXT NOT NULL,
    "amount" DECIMAL(24,2) NOT NULL,

    CONSTRAINT "consignado_bank_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignado_status_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consignado_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consignado_originators_code_key" ON "consignado_originators"("code");

-- CreateIndex
CREATE INDEX "consignado_settlement_batches_fund_id_reference_date_status_idx" ON "consignado_settlement_batches"("fund_id", "reference_date", "status");

-- CreateIndex
CREATE INDEX "consignado_settlement_batches_stock_batch_id_idx" ON "consignado_settlement_batches"("stock_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "consignado_settlement_batches_fund_id_source_file_hash_key" ON "consignado_settlement_batches"("fund_id", "source", "file_hash");

-- CreateIndex
CREATE INDEX "consignado_settlement_items_batch_id_status_idx" ON "consignado_settlement_items"("batch_id", "status");

-- CreateIndex
CREATE INDEX "consignado_settlement_items_your_number_idx" ON "consignado_settlement_items"("your_number");

-- CreateIndex
CREATE INDEX "consignado_settlement_items_contract_number_idx" ON "consignado_settlement_items"("contract_number");

-- CreateIndex
CREATE UNIQUE INDEX "consignado_settlement_items_batch_id_source_row_key" ON "consignado_settlement_items"("batch_id", "source_row");

-- CreateIndex
CREATE INDEX "consignado_manual_corrections_item_id_active_idx" ON "consignado_manual_corrections"("item_id", "active");

-- CreateIndex
CREATE INDEX "consignado_manual_corrections_replacement_position_id_idx" ON "consignado_manual_corrections"("replacement_position_id");

-- CreateIndex
CREATE INDEX "consignado_remittances_fund_id_status_idx" ON "consignado_remittances"("fund_id", "status");

-- CreateIndex
CREATE INDEX "consignado_remittances_stock_status_generated_at_idx" ON "consignado_remittances"("stock_status", "generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "consignado_remittances_batch_id_key" ON "consignado_remittances"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "consignado_remittances_storage_key_key" ON "consignado_remittances"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "consignado_remittance_items_settlement_item_id_key" ON "consignado_remittance_items"("settlement_item_id");

-- CreateIndex
CREATE INDEX "consignado_remittance_items_remittance_id_stock_status_idx" ON "consignado_remittance_items"("remittance_id", "stock_status");

-- CreateIndex
CREATE INDEX "consignado_remittance_items_your_number_document_number_idx" ON "consignado_remittance_items"("your_number", "document_number");

-- CreateIndex
CREATE UNIQUE INDEX "consignado_bank_statement_imports_fund_id_file_hash_key" ON "consignado_bank_statement_imports"("fund_id", "file_hash");

-- CreateIndex
CREATE UNIQUE INDEX "consignado_bank_credit_entries_fingerprint_key" ON "consignado_bank_credit_entries"("fingerprint");

-- CreateIndex
CREATE INDEX "consignado_bank_credit_entries_fund_id_status_transaction_d_idx" ON "consignado_bank_credit_entries"("fund_id", "status", "transaction_date");

-- CreateIndex
CREATE INDEX "consignado_bank_reconciliations_status_created_at_idx" ON "consignado_bank_reconciliations"("status", "created_at");

-- CreateIndex
CREATE INDEX "consignado_bank_allocations_bank_entry_id_idx" ON "consignado_bank_allocations"("bank_entry_id");

-- CreateIndex
CREATE INDEX "consignado_bank_allocations_remittance_id_idx" ON "consignado_bank_allocations"("remittance_id");

-- CreateIndex
CREATE UNIQUE INDEX "consignado_bank_allocations_reconciliation_id_bank_entry_id_key" ON "consignado_bank_allocations"("reconciliation_id", "bank_entry_id", "remittance_id");

-- CreateIndex
CREATE INDEX "consignado_status_events_entity_type_entity_id_created_at_idx" ON "consignado_status_events"("entity_type", "entity_id", "created_at");

-- AddForeignKey
ALTER TABLE "consignado_settlement_batches" ADD CONSTRAINT "consignado_settlement_batches_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_settlement_batches" ADD CONSTRAINT "consignado_settlement_batches_stock_batch_id_fkey" FOREIGN KEY ("stock_batch_id") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_settlement_batches" ADD CONSTRAINT "consignado_settlement_batches_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_settlement_batches" ADD CONSTRAINT "consignado_settlement_batches_originator_id_fkey" FOREIGN KEY ("originator_id") REFERENCES "consignado_originators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_settlement_items" ADD CONSTRAINT "consignado_settlement_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "consignado_settlement_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_settlement_items" ADD CONSTRAINT "consignado_settlement_items_matched_stock_position_id_fkey" FOREIGN KEY ("matched_stock_position_id") REFERENCES "receivable_stock_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_manual_corrections" ADD CONSTRAINT "consignado_manual_corrections_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "consignado_settlement_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_manual_corrections" ADD CONSTRAINT "consignado_manual_corrections_replacement_position_id_fkey" FOREIGN KEY ("replacement_position_id") REFERENCES "receivable_stock_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_manual_corrections" ADD CONSTRAINT "consignado_manual_corrections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_remittances" ADD CONSTRAINT "consignado_remittances_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "consignado_settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_remittances" ADD CONSTRAINT "consignado_remittances_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_remittances" ADD CONSTRAINT "consignado_remittances_generated_by_user_id_fkey" FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_remittances" ADD CONSTRAINT "consignado_remittances_checked_stock_batch_id_fkey" FOREIGN KEY ("checked_stock_batch_id") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_remittance_items" ADD CONSTRAINT "consignado_remittance_items_remittance_id_fkey" FOREIGN KEY ("remittance_id") REFERENCES "consignado_remittances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_remittance_items" ADD CONSTRAINT "consignado_remittance_items_settlement_item_id_fkey" FOREIGN KEY ("settlement_item_id") REFERENCES "consignado_settlement_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_remittance_items" ADD CONSTRAINT "consignado_remittance_items_stock_position_id_fkey" FOREIGN KEY ("stock_position_id") REFERENCES "receivable_stock_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_bank_statement_imports" ADD CONSTRAINT "consignado_bank_statement_imports_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_bank_statement_imports" ADD CONSTRAINT "consignado_bank_statement_imports_imported_by_user_id_fkey" FOREIGN KEY ("imported_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_bank_credit_entries" ADD CONSTRAINT "consignado_bank_credit_entries_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "consignado_bank_statement_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_bank_credit_entries" ADD CONSTRAINT "consignado_bank_credit_entries_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_bank_reconciliations" ADD CONSTRAINT "consignado_bank_reconciliations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_bank_reconciliations" ADD CONSTRAINT "consignado_bank_reconciliations_undone_by_user_id_fkey" FOREIGN KEY ("undone_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_bank_allocations" ADD CONSTRAINT "consignado_bank_allocations_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "consignado_bank_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_bank_allocations" ADD CONSTRAINT "consignado_bank_allocations_bank_entry_id_fkey" FOREIGN KEY ("bank_entry_id") REFERENCES "consignado_bank_credit_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_bank_allocations" ADD CONSTRAINT "consignado_bank_allocations_remittance_id_fkey" FOREIGN KEY ("remittance_id") REFERENCES "consignado_remittances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignado_status_events" ADD CONSTRAINT "consignado_status_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Originadores permitidos no primeiro fluxo operacional.
INSERT INTO "consignado_originators" ("id", "code", "name", "source") VALUES
  ('consignado-originator-gibb', 'GIBB', 'GIBB', 'BMP'),
  ('consignado-originator-juca', 'JUCA', 'JUCA', 'BMP'),
  ('consignado-originator-bankerize', 'BANKERIZE', 'BANKERIZE', 'BMP'),
  ('consignado-originator-uy3', 'UY3', 'UY3', 'UY3');
