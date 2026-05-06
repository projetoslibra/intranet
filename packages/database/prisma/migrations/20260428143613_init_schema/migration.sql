-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "FundType" AS ENUM ('FIDC', 'FIM', 'FIA', 'RENDA_FIXA', 'MULTIMERCADO', 'OUTRO');

-- CreateEnum
CREATE TYPE "FundStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "FundAccessLevel" AS ENUM ('VIEW', 'MANAGE');

-- CreateEnum
CREATE TYPE "DreAccountType" AS ENUM ('REVENUE', 'EXPENSE', 'ASSET', 'LIABILITY', 'EQUITY');

-- CreateEnum
CREATE TYPE "CashAccountType" AS ENUM ('CHECKING', 'SAVINGS', 'INVESTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CashAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashTransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "ImportModule" AS ENUM ('FUNDS', 'QUOTES', 'DRE', 'CASH', 'POSITIONS', 'USERS');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "funds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "fundType" "FundType" NOT NULL,
    "status" "FundStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_fund_accesses" (
    "userId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "accessLevel" "FundAccessLevel" NOT NULL,

    CONSTRAINT "user_fund_accesses_pkey" PRIMARY KEY ("userId","fundId")
);

-- CreateTable
CREATE TABLE "fund_quotes" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "quoteDate" DATE NOT NULL,
    "quotaValue" DECIMAL(20,8) NOT NULL,
    "netAssetValue" DECIMAL(20,2) NOT NULL,
    "sharesQuantity" DECIMAL(20,8) NOT NULL,
    "dailyReturn" DECIMAL(12,8) NOT NULL,
    "monthReturn" DECIMAL(12,8) NOT NULL,
    "yearReturn" DECIMAL(12,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dre_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DreAccountType" NOT NULL,

    CONSTRAINT "dre_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dre_entries" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "referenceDate" DATE NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL,

    CONSTRAINT "dre_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_cash_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountType" "CashAccountType" NOT NULL,
    "status" "CashAccountStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "company_cash_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_cash_transactions" (
    "id" TEXT NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "transactionDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "type" "CashTransactionType" NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "category" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "company_cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_positions" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "positionDate" DATE NOT NULL,
    "assetClass" TEXT NOT NULL,
    "assetName" TEXT NOT NULL,
    "quantity" DECIMAL(20,8) NOT NULL,
    "grossValue" DECIMAL(20,2) NOT NULL,
    "netValue" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "financial_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "importedByUserId" TEXT NOT NULL,
    "module" "ImportModule" NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "funds_cnpj_key" ON "funds"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "fund_quotes_fundId_quoteDate_key" ON "fund_quotes"("fundId", "quoteDate");

-- CreateIndex
CREATE UNIQUE INDEX "dre_accounts_code_key" ON "dre_accounts"("code");

-- CreateIndex
CREATE INDEX "dre_entries_fundId_referenceDate_idx" ON "dre_entries"("fundId", "referenceDate");

-- CreateIndex
CREATE INDEX "company_cash_transactions_cashAccountId_transactionDate_idx" ON "company_cash_transactions"("cashAccountId", "transactionDate");

-- CreateIndex
CREATE INDEX "financial_positions_fundId_positionDate_idx" ON "financial_positions"("fundId", "positionDate");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_fund_accesses" ADD CONSTRAINT "user_fund_accesses_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_fund_accesses" ADD CONSTRAINT "user_fund_accesses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_quotes" ADD CONSTRAINT "fund_quotes_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dre_entries" ADD CONSTRAINT "dre_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "dre_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dre_entries" ADD CONSTRAINT "dre_entries_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_cash_transactions" ADD CONSTRAINT "company_cash_transactions_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "company_cash_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_positions" ADD CONSTRAINT "financial_positions_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_importedByUserId_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
