import { Prisma } from "@prisma/client";

export type OperationIndicatorRow = {
  acquisitionValue: Prisma.Decimal;
  termDays: number | null;
  annualAssignmentRate: Prisma.Decimal | null;
};

export type OperationIndicatorCalculation = {
  status: "ready" | "empty" | "invalid";
  issue?: string;
  amount: Prisma.Decimal;
  operationCount: number;
  termWeightedValue: Prisma.Decimal | null;
  termWeightAmount: Prisma.Decimal | null;
  monthlyRateWeightedValue: Prisma.Decimal | null;
  monthlyRateWeightAmount: Prisma.Decimal | null;
};

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);
const MONTHS_PER_YEAR = new Prisma.Decimal(12);

function withoutIndicators(
  status: "empty" | "invalid",
  amount: Prisma.Decimal,
  operationCount: number,
  issue?: string
): OperationIndicatorCalculation {
  return {
    status,
    issue,
    amount,
    operationCount,
    termWeightedValue: null,
    termWeightAmount: null,
    monthlyRateWeightedValue: null,
    monthlyRateWeightAmount: null,
  };
}

export function calculateOperationIndicators(
  rows: OperationIndicatorRow[]
): OperationIndicatorCalculation {
  const amount = rows.reduce(
    (total, row) => total.plus(row.acquisitionValue),
    ZERO
  );

  for (const row of rows) {
    if (row.acquisitionValue.isNegative()) {
      return withoutIndicators(
        "invalid",
        amount,
        rows.length,
        "Valor de aquisição negativo não pode ponderar os indicadores."
      );
    }

    if (row.acquisitionValue.isZero()) continue;

    if (row.termDays === null) {
      return withoutIndicators(
        "invalid",
        amount,
        rows.length,
        "Prazo ausente em operação com valor de aquisição positivo."
      );
    }

    if (row.annualAssignmentRate === null) {
      return withoutIndicators(
        "invalid",
        amount,
        rows.length,
        "Taxa de cessão ausente em operação com valor de aquisição positivo."
      );
    }

    if (row.annualAssignmentRate.lessThanOrEqualTo(-1)) {
      return withoutIndicators(
        "invalid",
        amount,
        rows.length,
        "Taxa de cessão inválida para conversão efetiva mensal."
      );
    }
  }

  const weightedRows = rows.filter((row) => row.acquisitionValue.greaterThan(0));
  if (weightedRows.length === 0) {
    return withoutIndicators("empty", amount, rows.length);
  }

  let termWeightedValue = ZERO;
  let monthlyRateWeightedValue = ZERO;
  let weightAmount = ZERO;
  const monthlyExponent = ONE.dividedBy(MONTHS_PER_YEAR);

  for (const row of weightedRows) {
    const weight = row.acquisitionValue;
    const monthlyRate = ONE.plus(row.annualAssignmentRate!)
      .pow(monthlyExponent)
      .minus(ONE);

    weightAmount = weightAmount.plus(weight);
    termWeightedValue = termWeightedValue.plus(weight.times(row.termDays!));
    monthlyRateWeightedValue = monthlyRateWeightedValue.plus(
      weight.times(monthlyRate)
    );
  }

  return {
    status: "ready",
    amount,
    operationCount: rows.length,
    termWeightedValue,
    termWeightAmount: weightAmount,
    monthlyRateWeightedValue,
    monthlyRateWeightAmount: weightAmount,
  };
}
