-- CreateTable
CREATE TABLE "company_cash_daily_balances" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "referenceDate" DATE NOT NULL,
    "receivingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reconciliationBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reserveBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "usedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_cash_daily_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_cash_daily_balances_fundId_referenceDate_key"
ON "company_cash_daily_balances"("fundId", "referenceDate");

-- CreateIndex
CREATE INDEX "company_cash_daily_balances_referenceDate_idx"
ON "company_cash_daily_balances"("referenceDate");

-- AddForeignKey
ALTER TABLE "company_cash_daily_balances"
ADD CONSTRAINT "company_cash_daily_balances_fundId_fkey"
FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
