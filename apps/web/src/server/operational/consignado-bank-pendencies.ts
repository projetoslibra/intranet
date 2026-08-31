import { Prisma } from "@prisma/client";

type DecimalValue = Prisma.Decimal | string | number;

/**
 * Uma conciliação ativa cujo total de entradas supera o total de remessas significa
 * dinheiro que caiu no banco sem título correspondente na remessa: conciliado, mas
 * não baixado. O sentido inverso (remessa maior que entrada) é o problema oposto e
 * não entra nesta conta.
 *
 * O filtro precisa comparar as duas colunas porque `differenceAmount` é gravado em
 * valor absoluto (`signedDifference.abs()` em consignado-reconciliation.ts), logo a
 * coluna sozinha não distingue as duas direções.
 */
export type UnsettledReconciliationRow = {
  entryTotalAmount: DecimalValue;
  remittanceTotalAmount: DecimalValue;
  differenceAmount: DecimalValue;
};

export type UnsettledOverview = { count: number; amount: string };

export function summarizeUnsettledReconciliations(rows: readonly UnsettledReconciliationRow[]): UnsettledOverview {
  let count = 0;
  let amount = new Prisma.Decimal(0);
  rows.forEach((row) => {
    if (!new Prisma.Decimal(row.entryTotalAmount).gt(new Prisma.Decimal(row.remittanceTotalAmount))) return;
    count += 1;
    amount = amount.add(new Prisma.Decimal(row.differenceAmount));
  });
  return { count, amount: amount.toFixed(2) };
}

export type UnsettledOverviewDatabase = {
  consignadoBankReconciliation: {
    findMany(args: Record<string, unknown>): Promise<ReadonlyArray<UnsettledReconciliationRow>>;
  };
};

export const unsettledOverviewQuery = {
  where: { status: "ACTIVE" },
  select: { entryTotalAmount: true, remittanceTotalAmount: true, differenceAmount: true },
} as const;

export async function getUnsettledOverviewWithDependencies(database: UnsettledOverviewDatabase) {
  return summarizeUnsettledReconciliations(await database.consignadoBankReconciliation.findMany({ ...unsettledOverviewQuery }));
}

export async function getUnsettledOverview() {
  const { prisma } = await import("@/lib/prisma");
  return getUnsettledOverviewWithDependencies(prisma as unknown as UnsettledOverviewDatabase);
}
