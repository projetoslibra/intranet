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

export type ReconciliationPlan = {
  entryTotal: Prisma.Decimal;
  remittanceTotal: Prisma.Decimal;
  allocatedTotal: Prisma.Decimal;
  difference: Prisma.Decimal;
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

export function planConsignadoReconciliation(input: {
  entries: ReconciliationBalance[];
  remittances: ReconciliationBalance[];
}): ReconciliationPlan {
  const entries = input.entries.map((item) => ({ ...item, remaining: new Prisma.Decimal(item.remaining) }));
  const remittances = input.remittances.map((item) => ({ ...item, remaining: new Prisma.Decimal(item.remaining) }));
  const entryTotal = total(entries);
  const remittanceTotal = total(remittances);
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
    difference: entryTotal.sub(remittanceTotal).abs(),
    allocations,
    entryAdjustments,
    remittanceAdjustments,
  };
}
