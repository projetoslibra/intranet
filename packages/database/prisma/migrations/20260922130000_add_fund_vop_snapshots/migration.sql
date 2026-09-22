CREATE TABLE "fund_vop_snapshots" (
    "id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "reference_date" DATE NOT NULL,
    "amount" DECIMAL(24,10) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_vop_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fund_vop_snapshots_reference_date_idx"
    ON "fund_vop_snapshots"("reference_date");

CREATE UNIQUE INDEX "fund_vop_snapshots_fund_id_reference_date_key"
    ON "fund_vop_snapshots"("fund_id", "reference_date");

ALTER TABLE "fund_vop_snapshots"
    ADD CONSTRAINT "fund_vop_snapshots_fund_id_fkey"
    FOREIGN KEY ("fund_id") REFERENCES "funds"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
