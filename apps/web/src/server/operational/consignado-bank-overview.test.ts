import assert from "node:assert/strict";
import test from "node:test";
import { loadBankReconciliationView } from "./consignado-bank-overview";

test("carrega workspace e overview atualizados no mesmo contrato", async () => {
  const result = await loadBankReconciliationView(
    async () => ({ entries: [{ id: "entry-1" }] }),
    async () => ({ count: 2, amount: "30.00" }),
    () => assert.fail("não deveria registrar falha"),
  );
  assert.deepEqual(result, {
    workspace: { entries: [{ id: "entry-1" }] },
    openDifferences: { count: 2, amount: "30.00" },
  });
});

test("falha exclusiva do badge vira estado indisponível sem derrubar o workspace", async () => {
  const error = new Error("aggregate indisponível");
  const failures: unknown[] = [];
  const result = await loadBankReconciliationView(
    async () => ({ entries: [] }),
    async () => { throw error; },
    (received) => failures.push(received),
  );
  assert.deepEqual(result, { workspace: { entries: [] }, openDifferences: null });
  assert.deepEqual(failures, [error]);
});

test("falha do workspace continua seguindo para a política de erro principal", async () => {
  const error = new Error("workspace indisponível");
  await assert.rejects(
    loadBankReconciliationView(
      async () => { throw error; },
      async () => ({ count: 0, amount: "0.00" }),
      () => undefined,
    ),
    (received) => received === error,
  );
});
