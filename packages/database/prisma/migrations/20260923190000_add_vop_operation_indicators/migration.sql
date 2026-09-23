ALTER TABLE "fund_vop_snapshots"
  ADD COLUMN "operation_count" INTEGER,
  ADD COLUMN "term_weighted_value" DECIMAL(38,10),
  ADD COLUMN "term_weight_amount" DECIMAL(24,10),
  ADD COLUMN "monthly_rate_weighted_value" DECIMAL(38,20),
  ADD COLUMN "monthly_rate_weight_amount" DECIMAL(24,10),
  ADD COLUMN "indicators_calculated_at" TIMESTAMP(3);
