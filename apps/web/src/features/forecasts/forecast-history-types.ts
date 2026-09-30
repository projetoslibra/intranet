import type {
  ForecastItemStatus,
  ForecastSettlementMode,
} from "./forecast-execution";

export type ForecastProjectionSnapshot = {
  date: string;
  pddTurnover: number;
  pddReversal: number;
  pddNet: number;
  manualPddDelta: number;
  creditRightsRevenue: number;
  fundCost: number;
  creditRights: number;
  pdd: number;
  patrimonio: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
};

export type ForecastTitleSnapshotInput = {
  sourceStockId: string;
  plannedExecutionDate: string;
  settlementMode: ForecastSettlementMode;
  reversalAmount: number;
};

export type CreateForecastInput = {
  fundId: string;
  name: string;
  periodEnd: string;
  sourceForecastId?: string;
  stockReferenceDate: string;
  stockFundName: string;
  titles: ForecastTitleSnapshotInput[];
  projections: ForecastProjectionSnapshot[];
};

export type ForecastHistoryTitle = {
  id: string;
  sourceStockId: string;
  cedentName: string;
  debtorName: string;
  documentNumber: string;
  yourNumber: string | null;
  originalDueDate: string;
  nominalValue: string;
  pddValue: string;
  reversalAmount: string;
  settlementMode: ForecastSettlementMode;
  plannedExecutionDate: string;
  plannedImpactDate: string;
  status: ForecastItemStatus;
  executedAt: string | null;
  executedByName: string | null;
  actualExecutionDate: string | null;
  actualImpactDate: string | null;
  openMovementReferenceDate: string | null;
  openMovementPeriod: string | null;
  checkedStockReferenceDate: string | null;
};

export type ForecastHistoryEntry = {
  id: string;
  name: string;
  version: number;
  periodEnd: string;
  stockReferenceDate: string;
  isActive: boolean;
  createdAt: string;
  createdByName: string;
  manualPddInputs: Array<{ date: string; value: number }>;
  titles: ForecastHistoryTitle[];
};

export type ForecastActionResult = {
  ok: boolean;
  message: string;
  forecastId?: string;
};
