ALTER TABLE "import_batches"
  ADD COLUMN "fileSize" INTEGER,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "progressRows" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "warningRows" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "startedAt" TIMESTAMP(3);

ALTER TABLE "receivable_stock_positions"
  ADD COLUMN "source_row" INTEGER,
  ADD COLUMN "row_hash" TEXT;

CREATE INDEX "import_batches_module_fundId_referenceDate_isActive_idx"
  ON "import_batches"("module", "fundId", "referenceDate", "isActive");

-- Restrições limitadas ao novo fluxo para não alterar a semântica dos importadores
-- históricos de DRE, risco e estoques analíticos.
CREATE UNIQUE INDEX "import_batches_consignado_stock_file_hash_unique"
  ON "import_batches"("fundId", "fileHash")
  WHERE "module" = 'RECEIVABLE_STOCK'
    AND "source" = 'CONSIGNADO_STOCK_MANUAL'
    AND "fileHash" IS NOT NULL;

CREATE UNIQUE INDEX "import_batches_consignado_stock_version_unique"
  ON "import_batches"("fundId", "referenceDate", "version")
  WHERE "module" = 'RECEIVABLE_STOCK'
    AND "source" = 'CONSIGNADO_STOCK_MANUAL'
    AND "referenceDate" IS NOT NULL;

CREATE UNIQUE INDEX "receivable_stock_positions_batchId_source_row_key"
  ON "receivable_stock_positions"("batchId", "source_row");

CREATE INDEX "receivable_stock_positions_batchId_your_number_idx"
  ON "receivable_stock_positions"("batchId", "your_number");

CREATE INDEX "receivable_stock_positions_batchId_document_number_idx"
  ON "receivable_stock_positions"("batchId", "document_number");

CREATE INDEX "receivable_stock_positions_batchId_debtor_document_idx"
  ON "receivable_stock_positions"("batchId", "debtor_document");

CREATE UNIQUE INDEX "import_batches_one_active_stock_snapshot"
  ON "import_batches"("fundId", "referenceDate")
  WHERE "module" = 'RECEIVABLE_STOCK'
    AND "source" = 'CONSIGNADO_STOCK_MANUAL'
    AND "isActive" = true;
