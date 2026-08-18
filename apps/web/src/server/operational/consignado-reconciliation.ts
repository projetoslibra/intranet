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

const ZERO = new Prisma.Decimal(0);

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
