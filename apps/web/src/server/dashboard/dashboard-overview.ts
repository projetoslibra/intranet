import { Prisma } from "@prisma/client";

export type FundOperationalStatus =
  | "ready"
  | "no_operations"
  | "not_integrated"
  | "no_data";

export type DashboardFundInput = {
  id: string;
  name: string;
  shortName: string;
  cnpj: string;
  positionDate: Date | null;
  totalPl: number | null;
  seniorValue: number;
  mezzanineValue: number;
  juniorValue: number;
  dailyReturn: number;
  monthReturn: number;
  yearReturn: number;
  averageMonthlyRevenue: number;
  averageMonthlyCost: number;
  monthlyRevenueTotal: number;
  monthlyCostTotal: number;
  monthlyRevenuePeriods: number;
  monthlyCostPeriods: number;
  economicsStatus: "ready" | "no_data";
  vopIntegrated: boolean;
};

export type DashboardSnapshotInput = {
  fundId: string;
  referenceDate: Date;
  amount: string;
  operationCount: number | null;
  termWeightedValue: string | null;
  termWeightAmount: string | null;
  monthlyRateWeightedValue: string | null;
  monthlyRateWeightAmount: string | null;
  indicatorsCalculatedAt: Date | null;
};

export type DashboardFundRow = DashboardFundInput & {
  financialStatus: "ready" | "no_data";
  vop: {
    status: FundOperationalStatus;
    referenceDate: Date | null;
    dailyAmount: number | null;
    monthlyAmount: number | null;
    termDays: number | null;
    monthlyRate: number | null;
  };
};

export type DashboardOverview = {
  consolidatedPl: number;
  activeFundCount: number;
  vop: {
    status: "ready" | "no_operations" | "no_data";
    cutoffDate: Date | null;
    dailyAmount: number | null;
    monthlyAmount: number | null;
    integratedFunds: number;
    totalFunds: number;
  };
  funds: DashboardFundRow[];
};

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthKey(value: Date) {
  return dateKey(value).slice(0, 7);
}

function findLatestCommonDate(
  fundIds: string[],
  snapshots: DashboardSnapshotInput[]
) {
  if (fundIds.length === 0) return null;

  const datesByFund = new Map<string, Set<string>>(
    fundIds.map((fundId) => [fundId, new Set<string>()])
  );

  for (const snapshot of snapshots) {
    datesByFund.get(snapshot.fundId)?.add(dateKey(snapshot.referenceDate));
  }

  const [firstFundId, ...remainingFundIds] = fundIds;
  const commonDates = Array.from(datesByFund.get(firstFundId) ?? []).filter(
    (key) => remainingFundIds.every((fundId) => datesByFund.get(fundId)?.has(key))
  );
  const latest = commonDates.sort().at(-1);
  return latest ? new Date(`${latest}T00:00:00.000Z`) : null;
}

function decimalAverage(numerator: string | null, denominator: string | null) {
  if (numerator === null || denominator === null) return null;
  const weight = new Prisma.Decimal(denominator);
  if (weight.isZero()) return null;
  return Number(new Prisma.Decimal(numerator).dividedBy(weight));
}

function sumAmounts(snapshots: DashboardSnapshotInput[]) {
  return Number(
    snapshots.reduce(
      (total, snapshot) => total.plus(snapshot.amount),
      new Prisma.Decimal(0)
    )
  );
}

export function buildDashboardOverview(input: {
  funds: DashboardFundInput[];
  snapshots: DashboardSnapshotInput[];
}): DashboardOverview {
  const integratedFundIds = input.funds
    .filter((fund) => fund.vopIntegrated)
    .map((fund) => fund.id);
  const cutoffDate = findLatestCommonDate(integratedFundIds, input.snapshots);
  const cutoffKey = cutoffDate ? dateKey(cutoffDate) : null;
  const cutoffMonth = cutoffDate ? monthKey(cutoffDate) : null;

  const funds = input.funds.map<DashboardFundRow>((fund) => {
    const financialStatus =
      fund.totalPl === null || fund.positionDate === null ? "no_data" : "ready";

    if (!fund.vopIntegrated) {
      return {
        ...fund,
        financialStatus,
        vop: {
          status: "not_integrated",
          referenceDate: null,
          dailyAmount: null,
          monthlyAmount: null,
          termDays: null,
          monthlyRate: null,
        },
      };
    }

    const dailySnapshot = cutoffKey
      ? input.snapshots.find(
          (snapshot) =>
            snapshot.fundId === fund.id &&
            dateKey(snapshot.referenceDate) === cutoffKey
        )
      : undefined;

    if (!dailySnapshot || !cutoffMonth || !cutoffKey) {
      return {
        ...fund,
        financialStatus,
        vop: {
          status: "no_data",
          referenceDate: null,
          dailyAmount: null,
          monthlyAmount: null,
          termDays: null,
          monthlyRate: null,
        },
      };
    }

    const dailyAmount = Number(dailySnapshot.amount);
    const monthlyAmount = sumAmounts(
      input.snapshots.filter(
        (snapshot) =>
          snapshot.fundId === fund.id &&
          monthKey(snapshot.referenceDate) === cutoffMonth &&
          dateKey(snapshot.referenceDate) <= cutoffKey
      )
    );
    const hasIndicators = dailySnapshot.indicatorsCalculatedAt !== null;
    const status: FundOperationalStatus =
      dailyAmount === 0
        ? "no_operations"
        : hasIndicators
          ? "ready"
          : "no_data";

    return {
      ...fund,
      financialStatus,
      vop: {
        status,
        referenceDate: cutoffDate,
        dailyAmount,
        monthlyAmount,
        termDays:
          status === "ready"
            ? decimalAverage(
                dailySnapshot.termWeightedValue,
                dailySnapshot.termWeightAmount
              )
            : null,
        monthlyRate:
          status === "ready"
            ? decimalAverage(
                dailySnapshot.monthlyRateWeightedValue,
                dailySnapshot.monthlyRateWeightAmount
              )
            : null,
      },
    };
  });

  const dailyAmount = cutoffDate
    ? funds.reduce((total, fund) => total + (fund.vop.dailyAmount ?? 0), 0)
    : null;
  const monthlyAmount = cutoffDate
    ? funds.reduce((total, fund) => total + (fund.vop.monthlyAmount ?? 0), 0)
    : null;

  return {
    consolidatedPl: funds.reduce((total, fund) => total + (fund.totalPl ?? 0), 0),
    activeFundCount: funds.length,
    vop: {
      status:
        dailyAmount === null
          ? "no_data"
          : dailyAmount === 0
            ? "no_operations"
            : "ready",
      cutoffDate,
      dailyAmount,
      monthlyAmount,
      integratedFunds: integratedFundIds.length,
      totalFunds: funds.length,
    },
    funds,
  };
}
