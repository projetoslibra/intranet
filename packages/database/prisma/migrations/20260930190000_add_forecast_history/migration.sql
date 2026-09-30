CREATE TYPE "ForecastSettlementMode" AS ENUM ('D0', 'NEXT_BUSINESS_DAY');
CREATE TYPE "ForecastExecutionStatus" AS ENUM ('PENDING', 'EXECUTED', 'STOCK_CONFIRMED', 'DIVERGENT');

CREATE TABLE "forecasts" (
  "id" TEXT NOT NULL,
  "fund_id" TEXT NOT NULL,
  "created_by_user_id" TEXT NOT NULL,
  "source_forecast_id" TEXT,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "period_end" DATE NOT NULL,
  "stock_reference_date" DATE NOT NULL,
  "stock_fund_name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "forecasts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forecast_daily_projections" (
  "id" TEXT NOT NULL,
  "forecast_id" TEXT NOT NULL,
  "projection_date" DATE NOT NULL,
  "pdd_turnover" DECIMAL(24,10) NOT NULL DEFAULT 0,
  "pdd_reversal" DECIMAL(24,10) NOT NULL DEFAULT 0,
  "pdd_net" DECIMAL(24,10) NOT NULL DEFAULT 0,
  "manual_pdd_delta" DECIMAL(24,10) NOT NULL DEFAULT 0,
  "credit_rights_revenue" DECIMAL(24,10) NOT NULL DEFAULT 0,
  "fund_cost" DECIMAL(24,10) NOT NULL DEFAULT 0,
  "credit_rights" DECIMAL(24,10) NOT NULL DEFAULT 0,
  "pdd" DECIMAL(24,10) NOT NULL DEFAULT 0,
  "patrimonio" DECIMAL(24,10) NOT NULL DEFAULT 0,
  "daily_return" DECIMAL(18,10) NOT NULL DEFAULT 0,
  "monthly_return" DECIMAL(18,10) NOT NULL DEFAULT 0,
  "yearly_return" DECIMAL(18,10) NOT NULL DEFAULT 0,
  CONSTRAINT "forecast_daily_projections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "forecast_titles" (
  "id" TEXT NOT NULL,
  "forecast_id" TEXT NOT NULL,
  "source_stock_id" UUID NOT NULL,
  "cedent_name" TEXT NOT NULL,
  "cedent_document" TEXT,
  "debtor_name" TEXT NOT NULL,
  "debtor_document" TEXT,
  "document_number" TEXT NOT NULL,
  "your_number" TEXT,
  "original_due_date" DATE NOT NULL,
  "nominal_value" DECIMAL(24,10) NOT NULL,
  "present_value" DECIMAL(24,10) NOT NULL,
  "pdd_value" DECIMAL(24,10) NOT NULL,
  "reversal_amount" DECIMAL(24,10) NOT NULL,
  "settlement_mode" "ForecastSettlementMode" NOT NULL,
  "planned_execution_date" DATE NOT NULL,
  "planned_impact_date" DATE NOT NULL,
  "status" "ForecastExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "executed_at" TIMESTAMP(3),
  "executed_by_user_id" TEXT,
  "actual_execution_date" DATE,
  "actual_impact_date" DATE,
  "open_movement_reference_date" DATE,
  "open_movement_period" TEXT,
  "open_movement_observed_at" TIMESTAMP(3),
  "checked_stock_reference_date" DATE,
  "stock_confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "forecast_titles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "forecasts_fund_id_period_end_version_key" ON "forecasts"("fund_id", "period_end", "version");
CREATE INDEX "forecasts_fund_id_is_active_created_at_idx" ON "forecasts"("fund_id", "is_active", "created_at");
CREATE UNIQUE INDEX "forecast_daily_projections_forecast_id_projection_date_key" ON "forecast_daily_projections"("forecast_id", "projection_date");
CREATE INDEX "forecast_daily_projections_projection_date_idx" ON "forecast_daily_projections"("projection_date");
CREATE UNIQUE INDEX "forecast_titles_forecast_id_source_stock_id_key" ON "forecast_titles"("forecast_id", "source_stock_id");
CREATE INDEX "forecast_titles_forecast_id_planned_execution_date_idx" ON "forecast_titles"("forecast_id", "planned_execution_date");
CREATE INDEX "forecast_titles_status_actual_impact_date_idx" ON "forecast_titles"("status", "actual_impact_date");
CREATE INDEX "forecast_titles_document_number_original_due_date_idx" ON "forecast_titles"("document_number", "original_due_date");

ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_source_forecast_id_fkey" FOREIGN KEY ("source_forecast_id") REFERENCES "forecasts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "forecast_daily_projections" ADD CONSTRAINT "forecast_daily_projections_forecast_id_fkey" FOREIGN KEY ("forecast_id") REFERENCES "forecasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forecast_titles" ADD CONSTRAINT "forecast_titles_forecast_id_fkey" FOREIGN KEY ("forecast_id") REFERENCES "forecasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "forecast_titles" ADD CONSTRAINT "forecast_titles_executed_by_user_id_fkey" FOREIGN KEY ("executed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
