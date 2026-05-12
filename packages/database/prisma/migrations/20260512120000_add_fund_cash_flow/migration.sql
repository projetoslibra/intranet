DO $$
BEGIN
    ALTER TYPE "FundType" ADD VALUE 'FII';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE "fund_cash_flows" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "flowDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "flowType" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'QITECH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_cash_flows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fund_cash_flows_fundId_flowDate_description_flowType_assetCode_key"
ON "fund_cash_flows"("fundId", "flowDate", "description", "flowType", "assetCode");

ALTER TABLE "fund_cash_flows"
ADD CONSTRAINT "fund_cash_flows_fundId_fkey"
FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
