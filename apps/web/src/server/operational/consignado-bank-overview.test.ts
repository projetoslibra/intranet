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
    unsettled: null,
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
  assert.deepEqual(result, { workspace: { entries: [] }, openDifferences: null, unsettled: null });
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

test("carrega o indicador de conciliado sem baixa junto dos demais", async () => {
  const result = await loadBankReconciliationView(
    async () => ({ entries: [] }),
    async () => ({ count: 4, amount: "997.58" }),
    () => assert.fail("não deveria registrar falha no badge"),
    { load: async () => ({ count: 32, amount: "60612.73" }), onFailure: () => assert.fail("não deveria registrar falha no indicador") },
  );
  assert.deepEqual(result, {
    workspace: { entries: [] },
    openDifferences: { count: 4, amount: "997.58" },
    unsettled: { count: 32, amount: "60612.73" },
  });
});

test("falha exclusiva do indicador de conciliado sem baixa preserva o restante da tela", async () => {
  const error = new Error("findMany indisponível");
  const failures: unknown[] = [];
  const result = await loadBankReconciliationView(
    async () => ({ entries: [{ id: "entry-9" }] }),
    async () => ({ count: 1, amount: "10.00" }),
    () => assert.fail("não deveria registrar falha no badge"),
    { load: async () => { throw error; }, onFailure: (received) => failures.push(received) },
  );
  assert.deepEqual(result, {
    workspace: { entries: [{ id: "entry-9" }] },
    openDifferences: { count: 1, amount: "10.00" },
    unsettled: null,
  });
  assert.deepEqual(failures, [error]);
});

test("dispara os três carregamentos em paralelo, sem encadear esperas", async () => {
  const started: string[] = [];
  let releaseWorkspace = () => {};
  const workspaceGate = new Promise<void>((resolve) => { releaseWorkspace = resolve; });
  const view = loadBankReconciliationView(
    async () => { started.push("workspace"); await workspaceGate; return { entries: [] }; },
    async () => { started.push("badge"); return { count: 0, amount: "0.00" }; },
    () => undefined,
    { load: async () => { started.push("indicador"); return { count: 0, amount: "0.00" }; }, onFailure: () => undefined },
  );
  assert.deepEqual(started.slice().sort(), ["badge", "indicador", "workspace"]);
  releaseWorkspace();
  await view;
});
