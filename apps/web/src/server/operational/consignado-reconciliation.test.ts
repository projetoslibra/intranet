import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { planConsignadoReconciliation } from "./consignado-reconciliation";

const balance = (id: string, remaining: string) => ({ id, remaining: new Prisma.Decimal(remaining) });
const differenceTitle = (id: string, remittanceId: string, amount: string) => ({
  id,
  remittanceId,
  amount: new Prisma.Decimal(amount),
});
const other = (
  amount: string,
  category: "BANK_FEE" | "UNIDENTIFIED_CREDIT" | "VALUE_DIFFERENCE" | "ROUNDING" | "TIMING_DIFFERENCE" | "OTHER",
  reason: string,
  direction: "ENTRY_EXCESS" | "REMITTANCE_EXCESS" = "ENTRY_EXCESS",
) => ({ amount: new Prisma.Decimal(amount), category, reason, direction });
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

test("fecha excedente da entrada com títulos excluídos", () => {
  const plan = planConsignadoReconciliation({
    entries: [balance("e1", "1000.00")],
    remittances: [balance("r1", "900.00")],
    differenceTitles: [differenceTitle("x1", "r1", "60.00"), differenceTitle("x2", "r1", "40.00")],
    otherDifferences: [],
  });

  assert.equal(plan.titleDifferenceTotal.toFixed(2), "100.00");
  assert.equal(plan.unexplainedDifference.toFixed(2), "0.00");
});

test("mantém saldo residual como outro ajuste", () => {
  const plan = planConsignadoReconciliation({
    entries: [balance("e1", "1000.00")],
    remittances: [balance("r1", "900.00")],
    differenceTitles: [differenceTitle("x1", "r1", "85.00")],
    otherDifferences: [other("15.00", "VALUE_DIFFERENCE", "Crédito complementar não identificado")],
  });

  assert.equal(plan.otherDifferenceTotal.toFixed(2), "15.00");
  assert.equal(plan.unexplainedDifference.toFixed(2), "0.00");
});

test("rejeita explicações acima da diferença", () => {
  assert.throws(() => planConsignadoReconciliation({
    entries: [balance("e1", "1000.00")],
    remittances: [balance("r1", "900.00")],
    differenceTitles: [differenceTitle("x1", "r1", "100.01")],
    otherDifferences: [],
  }), /excede a diferença/);
});

test("rejeita saldo de diferença ainda aberto", () => {
  assert.throws(() => planConsignadoReconciliation({
    entries: [balance("e1", "1000.00")],
    remittances: [balance("r1", "900.00")],
    differenceTitles: [differenceTitle("x1", "r1", "85.00")],
    otherDifferences: [],
  }), /Falta explicar a diferença/);
});

test("rejeita título de remessa não selecionada", () => {
  assert.throws(() => planConsignadoReconciliation({
    entries: [balance("e1", "1000.00")],
    remittances: [balance("r1", "900.00")],
    differenceTitles: [differenceTitle("x1", "r2", "100.00")],
    otherDifferences: [],
  }), /remessa não selecionada/);
});

test("rejeita título quando a remessa excede a entrada", () => {
  assert.throws(() => planConsignadoReconciliation({
    entries: [balance("e1", "900.00")],
    remittances: [balance("r1", "1000.00")],
    differenceTitles: [differenceTitle("x1", "r1", "100.00")],
    otherDifferences: [],
  }), /títulos só podem explicar excedente da entrada/i);
});

test("rejeita justificativa curta para outro ajuste", () => {
  assert.throws(() => planConsignadoReconciliation({
    entries: [balance("e1", "1000.00")],
    remittances: [balance("r1", "900.00")],
    differenceTitles: [],
    otherDifferences: [other("100.00", "VALUE_DIFFERENCE", "curt")],
  }), /Justificativa deve ter pelo menos 5 caracteres/);
});

test("rejeita direção diferente da diferença calculada", () => {
  assert.throws(() => planConsignadoReconciliation({
    entries: [balance("e1", "900.00")],
    remittances: [balance("r1", "1000.00")],
    differenceTitles: [],
    otherDifferences: [other("100.00", "BANK_FEE", "Tarifa bancária", "ENTRY_EXCESS")],
  }), /direção incorreta/);
});

test("rejeita categoria inválida para outro ajuste", () => {
  assert.throws(() => planConsignadoReconciliation({
    entries: [balance("e1", "1000.00")],
    remittances: [balance("r1", "900.00")],
    differenceTitles: [],
    otherDifferences: [{
      amount: new Prisma.Decimal("100.00"),
      category: "INVALID_CATEGORY" as never,
      direction: "ENTRY_EXCESS",
      reason: "Ajuste válido no restante",
    }],
  }), /categoria inválida/);
});

test("rejeita saldo de entrada com fração de centavo", () => {
  assert.throws(() => planConsignadoReconciliation({
    entries: [balance("e1", "1000.001")],
    remittances: [balance("r1", "900.00")],
    differenceTitles: [],
    otherDifferences: [other("100.001", "VALUE_DIFFERENCE", "Ajuste complementar")],
  }), /duas casas decimais/);
});

test("rejeita saldo de remessa com fração de centavo", () => {
  assert.throws(() => planConsignadoReconciliation({
    entries: [balance("e1", "1000.00")],
    remittances: [balance("r1", "900.001")],
    differenceTitles: [],
    otherDifferences: [other("99.999", "VALUE_DIFFERENCE", "Ajuste complementar")],
  }), /duas casas decimais/);
});

test("rejeita título de diferença com fração de centavo", () => {
  assert.throws(() => planConsignadoReconciliation({
    entries: [balance("e1", "1000.00")],
    remittances: [balance("r1", "900.00")],
    differenceTitles: [differenceTitle("x1", "r1", "100.001")],
    otherDifferences: [],
  }), /duas casas decimais/);
});

test("rejeita outro ajuste com fração de centavo", () => {
  assert.throws(() => planConsignadoReconciliation({
    entries: [balance("e1", "1000.00")],
    remittances: [balance("r1", "900.00")],
    differenceTitles: [],
    otherDifferences: [other("100.001", "VALUE_DIFFERENCE", "Ajuste complementar")],
  }), /duas casas decimais/);
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
