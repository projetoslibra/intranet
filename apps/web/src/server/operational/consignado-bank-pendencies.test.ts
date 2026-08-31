import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  getUnsettledOverviewWithDependencies,
  summarizeUnsettledReconciliations,
  unsettledOverviewQuery,
} from "./consignado-bank-pendencies";

test("soma apenas as conciliações em que a entrada supera a remessa", () => {
  const overview = summarizeUnsettledReconciliations([
    { entryTotalAmount: "1000.00", remittanceTotalAmount: "900.00", differenceAmount: "100.00" },
    { entryTotalAmount: "500.00", remittanceTotalAmount: "500.00", differenceAmount: "0.00" },
    { entryTotalAmount: "700.00", remittanceTotalAmount: "750.50", differenceAmount: "50.50" },
    { entryTotalAmount: "2000.00", remittanceTotalAmount: "1999.99", differenceAmount: "0.01" },
  ]);
  assert.deepEqual(overview, { count: 2, amount: "100.01" });
});

test("ignora a direção inversa mesmo quando ela domina o conjunto", () => {
  const overview = summarizeUnsettledReconciliations([
    { entryTotalAmount: "10.00", remittanceTotalAmount: "9999.00", differenceAmount: "9989.00" },
    { entryTotalAmount: "0.00", remittanceTotalAmount: "1.00", differenceAmount: "1.00" },
  ]);
  assert.deepEqual(overview, { count: 0, amount: "0.00" });
});

test("conjunto vazio devolve zero formatado", () => {
  assert.deepEqual(summarizeUnsettledReconciliations([]), { count: 0, amount: "0.00" });
});

test("acumula em Decimal sem erro de ponto flutuante", () => {
  const rows = Array.from({ length: 3 }, () => ({
    entryTotalAmount: new Prisma.Decimal("0.20"),
    remittanceTotalAmount: new Prisma.Decimal("0.10"),
    differenceAmount: new Prisma.Decimal("0.10"),
  }));
  assert.deepEqual(summarizeUnsettledReconciliations(rows), { count: 3, amount: "0.30" });
});

test("reproduz o retrato de produção medido em 31/08/2026", () => {
  const overview = summarizeUnsettledReconciliations([
    { entryTotalAmount: "59615.15", remittanceTotalAmount: "0.00", differenceAmount: "59615.15" },
    { entryTotalAmount: "997.58", remittanceTotalAmount: "0.00", differenceAmount: "997.58" },
  ]);
  assert.deepEqual(overview, { count: 2, amount: "60612.73" });
});

test("consulta somente as conciliações ativas e as três colunas necessárias", async () => {
  const calls: unknown[] = [];
  const overview = await getUnsettledOverviewWithDependencies({
    consignadoBankReconciliation: {
      findMany: async (args) => {
        calls.push(args);
        return [{ entryTotalAmount: "300.00", remittanceTotalAmount: "120.00", differenceAmount: "180.00" }];
      },
    },
  });
  assert.deepEqual(overview, { count: 1, amount: "180.00" });
  assert.deepEqual(calls, [{
    where: { status: "ACTIVE" },
    select: { entryTotalAmount: true, remittanceTotalAmount: true, differenceAmount: true },
  }]);
  assert.equal(unsettledOverviewQuery.where.status, "ACTIVE");
});
