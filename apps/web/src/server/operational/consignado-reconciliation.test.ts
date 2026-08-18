import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { planConsignadoReconciliation } from "./consignado-reconciliation";

const balance = (id: string, remaining: string) => ({ id, remaining: new Prisma.Decimal(remaining) });
const amounts = <T extends { amount: Prisma.Decimal }>(items: T[]) => items.map((item) => ({ ...item, amount: item.amount.toFixed(2) }));

test("aloca valores iguais sem ajustes", () => {
  const plan = planConsignadoReconciliation({ entries: [balance("e1", "53.00")], remittances: [balance("r1", "53.00")] });

  assert.equal(plan.entryTotal.toFixed(2), "53.00");
  assert.equal(plan.remittanceTotal.toFixed(2), "53.00");
  assert.equal(plan.allocatedTotal.toFixed(2), "53.00");
  assert.equal(plan.difference.toFixed(2), "0.00");
  assert.deepEqual(amounts(plan.allocations), [{ bankEntryId: "e1", remittanceId: "r1", amount: "53.00" }]);
  assert.deepEqual(plan.entryAdjustments, []);
  assert.deepEqual(plan.remittanceAdjustments, []);
});

test("ajusta o excedente da entrada", () => {
  const plan = planConsignadoReconciliation({ entries: [balance("e1", "53.00")], remittances: [balance("r1", "52.90")] });

  assert.equal(plan.allocatedTotal.toFixed(2), "52.90");
  assert.equal(plan.difference.toFixed(2), "0.10");
  assert.deepEqual(amounts(plan.entryAdjustments), [{ entityId: "e1", amount: "0.10" }]);
  assert.deepEqual(plan.remittanceAdjustments, []);
});

test("ajusta o excedente da remessa", () => {
  const plan = planConsignadoReconciliation({ entries: [balance("e1", "52.90")], remittances: [balance("r1", "53.00")] });

  assert.equal(plan.allocatedTotal.toFixed(2), "52.90");
  assert.equal(plan.difference.toFixed(2), "0.10");
  assert.deepEqual(plan.entryAdjustments, []);
  assert.deepEqual(amounts(plan.remittanceAdjustments), [{ entityId: "r1", amount: "0.10" }]);
});

test("distribui N:N de forma determinística", () => {
  const plan = planConsignadoReconciliation({
    entries: [balance("e1", "30.00"), balance("e2", "25.00")],
    remittances: [balance("r1", "20.00"), balance("r2", "32.00")],
  });

  assert.deepEqual(amounts(plan.allocations), [
    { bankEntryId: "e1", remittanceId: "r1", amount: "20.00" },
    { bankEntryId: "e1", remittanceId: "r2", amount: "10.00" },
    { bankEntryId: "e2", remittanceId: "r2", amount: "22.00" },
  ]);
  assert.deepEqual(amounts(plan.entryAdjustments), [{ entityId: "e2", amount: "3.00" }]);
  assert.deepEqual(plan.remittanceAdjustments, []);
});
