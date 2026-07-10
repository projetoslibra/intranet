-- AlterEnum
ALTER TYPE "ImportModule" ADD VALUE 'RECEIVABLE_STOCK';
ALTER TYPE "ImportModule" ADD VALUE 'RISK_LIMITS';
ALTER TYPE "ImportModule" ADD VALUE 'CEDENT_DIMENSION';

-- AlterTable
ALTER TABLE "import_batches"
ADD COLUMN "fileHash" TEXT,
ADD COLUMN "source" TEXT,
ADD COLUMN "storageKey" TEXT,
ADD COLUMN "referenceDate" DATE,
ADD COLUMN "fundId" TEXT,
ADD COLUMN "errorMessage" TEXT,
ADD COLUMN "completedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "cedent_dimension_snapshots" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "referenceDate" DATE,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "importedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cedent_dimension_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cedent_dimension_entries" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "commercial" TEXT,
    "group_name" TEXT,
    "cedentName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cedent_dimension_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_stock_positions" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "fund_name" TEXT NOT NULL,
    "fund_document" TEXT NOT NULL,
    "fund_date" DATE,
    "originator_name" TEXT,
    "originator_document" TEXT,
    "cedent_name" TEXT NOT NULL,
    "cedent_document" TEXT NOT NULL,
    "debtor_name" TEXT NOT NULL,
    "debtor_document" TEXT NOT NULL,
    "your_number" TEXT,
    "document_key" TEXT,
    "status" TEXT,
    "document_number" TEXT,
    "receivable_type" TEXT,
    "nominal_value" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "present_value" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "acquisition_value" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "pdd_value" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "pdd_range" TEXT,
    "reference_date" DATE NOT NULL,
    "original_due_date" DATE,
    "adjusted_due_date" DATE,
    "issued_at" DATE,
    "acquired_at" DATE,
    "term" INTEGER,
    "current_term" INTEGER,
    "receivable_situation" TEXT,
    "assignment_rate" DECIMAL(18,10),
    "receivable_rate" DECIMAL(18,10),
    "coobligation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receivable_stock_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_limit_positions" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reference_date" DATE NOT NULL,
    "cedent_dimension_entry_id" TEXT,
    "code" TEXT,
    "cedent_name" TEXT NOT NULL,
    "limit_global" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "limit_used" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "limit_available" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "overdue_amount" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "pending_financial_amount" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "check_problem_amount" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "check_to_confirm_amount" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "proof_ok_amount" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "tranche_total" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "tranche_used" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "tranche_available" DECIMAL(24,10) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_limit_positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_module_referenceDate_idx" ON "import_batches"("module", "referenceDate");

-- CreateIndex
CREATE INDEX "import_batches_fundId_referenceDate_idx" ON "import_batches"("fundId", "referenceDate");

-- CreateIndex
CREATE UNIQUE INDEX "cedent_dimension_snapshots_batchId_key" ON "cedent_dimension_snapshots"("batchId");

-- CreateIndex
CREATE INDEX "cedent_dimension_snapshots_referenceDate_createdAt_idx" ON "cedent_dimension_snapshots"("referenceDate", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cedent_dimension_entries_snapshotId_code_key" ON "cedent_dimension_entries"("snapshotId", "code");

-- CreateIndex
CREATE INDEX "cedent_dimension_entries_code_idx" ON "cedent_dimension_entries"("code");

-- CreateIndex
CREATE INDEX "receivable_stock_positions_batchId_idx" ON "receivable_stock_positions"("batchId");

-- CreateIndex
CREATE INDEX "receivable_stock_positions_fundId_reference_date_idx" ON "receivable_stock_positions"("fundId", "reference_date");

-- CreateIndex
CREATE INDEX "receivable_stock_positions_reference_date_cedent_document_idx" ON "receivable_stock_positions"("reference_date", "cedent_document");

-- CreateIndex
CREATE INDEX "receivable_stock_positions_reference_date_debtor_document_idx" ON "receivable_stock_positions"("reference_date", "debtor_document");

-- CreateIndex
CREATE INDEX "risk_limit_positions_batchId_idx" ON "risk_limit_positions"("batchId");

-- CreateIndex
CREATE INDEX "risk_limit_positions_reference_date_idx" ON "risk_limit_positions"("reference_date");

-- CreateIndex
CREATE INDEX "risk_limit_positions_code_idx" ON "risk_limit_positions"("code");

-- CreateIndex
CREATE INDEX "risk_limit_positions_cedent_dimension_entry_id_idx" ON "risk_limit_positions"("cedent_dimension_entry_id");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cedent_dimension_snapshots" ADD CONSTRAINT "cedent_dimension_snapshots_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cedent_dimension_snapshots" ADD CONSTRAINT "cedent_dimension_snapshots_importedByUserId_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cedent_dimension_entries" ADD CONSTRAINT "cedent_dimension_entries_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "cedent_dimension_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_stock_positions" ADD CONSTRAINT "receivable_stock_positions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_stock_positions" ADD CONSTRAINT "receivable_stock_positions_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_limit_positions" ADD CONSTRAINT "risk_limit_positions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_limit_positions" ADD CONSTRAINT "risk_limit_positions_cedent_dimension_entry_id_fkey" FOREIGN KEY ("cedent_dimension_entry_id") REFERENCES "cedent_dimension_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SeedPermissions
INSERT INTO "permissions" ("id", "key", "description") VALUES
('perm_operational_view', 'operational.view', 'Permissão operational.view'),
('perm_operational_finance_manage', 'operational.finance.manage', 'Permissão operational.finance.manage'),
('perm_operational_stock_import', 'operational.stock.import', 'Permissão operational.stock.import'),
('perm_operational_risk_import', 'operational.risk.import', 'Permissão operational.risk.import'),
('perm_operational_dimension_import', 'operational.dimension.import', 'Permissão operational.dimension.import')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
CROSS JOIN "permissions"
WHERE "roles"."name" = 'ADMIN'
  AND "permissions"."key" IN (
    'operational.view',
    'operational.finance.manage',
    'operational.stock.import',
    'operational.risk.import',
    'operational.dimension.import'
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
