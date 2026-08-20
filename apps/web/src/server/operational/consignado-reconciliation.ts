import { Prisma } from "@prisma/client";

export type ReconciliationBalance = {
  id: string;
  remaining: Prisma.Decimal;
};

export type PlannedAllocation = {
  bankEntryId: string;
  remittanceId: string;
  amount: Prisma.Decimal;
};

export type PlannedAdjustment = {
  entityId: string;
  amount: Prisma.Decimal;
};

export type DifferenceTitleInput = {
  id: string;
  remittanceId: string;
  amount: Prisma.Decimal;
};

export type OtherDifferenceInput = {
  category: "BANK_FEE" | "UNIDENTIFIED_CREDIT" | "VALUE_DIFFERENCE" | "ROUNDING" | "TIMING_DIFFERENCE" | "OTHER";
  direction: "ENTRY_EXCESS" | "REMITTANCE_EXCESS";
  amount: Prisma.Decimal;
  reason: string;
};

export type ReconciliationPlan = {
  entryTotal: Prisma.Decimal;
  remittanceTotal: Prisma.Decimal;
  allocatedTotal: Prisma.Decimal;
  signedDifference: Prisma.Decimal;
  difference: Prisma.Decimal;
  direction: "ENTRY_EXCESS" | "REMITTANCE_EXCESS";
  titleDifferenceTotal: Prisma.Decimal;
  otherDifferenceTotal: Prisma.Decimal;
  unexplainedDifference: Prisma.Decimal;
  allocations: PlannedAllocation[];
  entryAdjustments: PlannedAdjustment[];
  remittanceAdjustments: PlannedAdjustment[];
};

export type BatchReconciliationInput = {
  receivedAmount: string;
  remittances: Array<{
    id: string;
    status: string;
    totalAmount: string;
    allocatedAmount: string;
    adjustedAmount: string;
    allocations: Array<{
      amount: string;
      reconciliation: { id: string; status: string; createdAt: string };
      bankEntry: {
        id: string;
        transactionDate: string;
        description: string;
        document: string | null;
        amount: string;
      };
    }>;
  }>;
};

export type BatchReconciliationSummary = {
  paidAmount: string;
  remittanceAmount: string;
  reconciliationStatus: "NO_REMITTANCE" | "NOT_RECONCILED" | "PARTIALLY_RECONCILED" | "RECONCILED";
  entries: Array<{
    id: string;
    transactionDate: string;
    description: string;
    document: string | null;
    amount: string;
    allocatedAmount: string;
    reconciliationId: string;
    reconciledAt: string;
  }>;
};

const ZERO = new Prisma.Decimal(0);

export function summarizeBatchReconciliation(input: BatchReconciliationInput): BatchReconciliationSummary {
  const remittances = input.remittances.filter((remittance) => remittance.status !== "CANCELLED");
  const remittanceAmount = remittances.reduce(
    (sum, remittance) => sum.add(remittance.totalAmount),
    ZERO,
  );
  const settledAmount = remittances.reduce(
    (sum, remittance) => sum.add(remittance.allocatedAmount).add(remittance.adjustedAmount),
    ZERO,
  );

  const reconciliationStatus = remittances.length === 0
    ? "NO_REMITTANCE"
    : settledAmount.lte(0)
      ? "NOT_RECONCILED"
      : settledAmount.lt(remittanceAmount)
        ? "PARTIALLY_RECONCILED"
        : "RECONCILED";

  const entries = remittances.flatMap((remittance) => remittance.allocations
    .filter((allocation) => allocation.reconciliation.status === "ACTIVE")
    .map((allocation) => ({
      id: allocation.bankEntry.id,
      transactionDate: allocation.bankEntry.transactionDate,
      description: allocation.bankEntry.description,
      document: allocation.bankEntry.document,
      amount: new Prisma.Decimal(allocation.bankEntry.amount).toFixed(2),
      allocatedAmount: new Prisma.Decimal(allocation.amount).toFixed(2),
      reconciliationId: allocation.reconciliation.id,
      reconciledAt: allocation.reconciliation.createdAt,
    })));

  return {
    paidAmount: new Prisma.Decimal(input.receivedAmount).toFixed(2),
    remittanceAmount: remittanceAmount.toFixed(2),
    reconciliationStatus,
    entries,
  };
}

function total(items: ReconciliationBalance[]) {
  return items.reduce((sum, item) => sum.add(item.remaining), ZERO);
}

function totalDifferenceTitles(items: DifferenceTitleInput[]) {
  return items.reduce((sum, item) => sum.add(item.amount), ZERO);
}

function totalOtherDifferences(items: OtherDifferenceInput[]) {
  return items.reduce((sum, item) => sum.add(item.amount), ZERO);
}

export function planConsignadoReconciliation(input: {
  entries: ReconciliationBalance[];
  remittances: ReconciliationBalance[];
  differenceTitles?: DifferenceTitleInput[];
  otherDifferences?: OtherDifferenceInput[];
}): ReconciliationPlan {
  const entries = input.entries.map((item) => ({ ...item, remaining: new Prisma.Decimal(item.remaining) }));
  const remittances = input.remittances.map((item) => ({ ...item, remaining: new Prisma.Decimal(item.remaining) }));
  const entryTotal = total(entries);
  const remittanceTotal = total(remittances);
  const signedDifference = entryTotal.sub(remittanceTotal);
  const direction = signedDifference.gte(0) ? "ENTRY_EXCESS" : "REMITTANCE_EXCESS";
  const difference = signedDifference.abs();
  const differenceTitles = input.differenceTitles ?? [];
  const otherDifferences = input.otherDifferences ?? [];
  const titleDifferenceTotal = totalDifferenceTitles(differenceTitles);
  const otherDifferenceTotal = totalOtherDifferences(otherDifferences);
  const unexplainedDifference = difference.sub(titleDifferenceTotal).sub(otherDifferenceTotal);
  const selectedRemittanceIds = new Set(remittances.map((item) => item.id));
  const differenceTitleIds = new Set<string>();

  for (const title of differenceTitles) {
    if (!selectedRemittanceIds.has(title.remittanceId)) {
      throw new Error("Título pertence a uma remessa não selecionada.");
    }
    if (differenceTitleIds.has(title.id)) {
      throw new Error("Título não pode ser usado mais de uma vez.");
    }
    if (new Prisma.Decimal(title.amount).lte(0)) {
      throw new Error("Título deve ter valor positivo.");
    }
    differenceTitleIds.add(title.id);
  }

  if (direction === "REMITTANCE_EXCESS" && differenceTitles.length > 0) {
    throw new Error("Títulos só podem explicar excedente da entrada.");
  }

  for (const adjustment of otherDifferences) {
    if (adjustment.direction !== direction) {
      throw new Error("Outro ajuste possui direção incorreta.");
    }
    if (new Prisma.Decimal(adjustment.amount).lte(0)) {
      throw new Error("Outro ajuste deve ter valor positivo.");
    }
    if (adjustment.reason.trim().length < 5) {
      throw new Error("Justificativa deve ter pelo menos 5 caracteres.");
    }
  }

  const hasDifferenceComposition = input.differenceTitles !== undefined || input.otherDifferences !== undefined;
  if (hasDifferenceComposition && unexplainedDifference.lt(0)) {
    throw new Error("A explicação excede a diferença.");
  }
  if (hasDifferenceComposition && !unexplainedDifference.eq(0)) {
    throw new Error("Falta explicar a diferença.");
  }
  const allocations: PlannedAllocation[] = [];

  for (const entry of entries) {
    for (const remittance of remittances) {
      if (entry.remaining.lte(0)) break;
      if (remittance.remaining.lte(0)) continue;
      const amount = Prisma.Decimal.min(entry.remaining, remittance.remaining);
      allocations.push({ bankEntryId: entry.id, remittanceId: remittance.id, amount });
      entry.remaining = entry.remaining.sub(amount);
      remittance.remaining = remittance.remaining.sub(amount);
    }
  }

  const entryAdjustments = entries
    .filter((item) => item.remaining.gt(0))
    .map((item) => ({ entityId: item.id, amount: item.remaining }));
  const remittanceAdjustments = remittances
    .filter((item) => item.remaining.gt(0))
    .map((item) => ({ entityId: item.id, amount: item.remaining }));
  const allocatedTotal = allocations.reduce((sum, item) => sum.add(item.amount), ZERO);

  return {
    entryTotal,
    remittanceTotal,
    allocatedTotal,
    signedDifference,
    difference,
    direction,
    titleDifferenceTotal,
    otherDifferenceTotal,
    unexplainedDifference,
    allocations,
    entryAdjustments,
    remittanceAdjustments,
  };
}
