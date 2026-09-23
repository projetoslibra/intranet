import assert from "node:assert/strict";
import test from "node:test";
import {
  createDisabledFundModules,
  resolveFundModuleToggle,
  setFundModuleVisibilityWithDependencies,
} from "./module-visibility";

test("cria todos os modulos desligados para um fundo novo", () => {
  assert.deepEqual(createDisabledFundModules("fund-1"), [
    { fundId: "fund-1", module: "DASHBOARD", enabled: false },
    { fundId: "fund-1", module: "CASH", enabled: false },
    { fundId: "fund-1", module: "DRE", enabled: false },
    { fundId: "fund-1", module: "FORECASTS", enabled: false },
    { fundId: "fund-1", module: "PDD", enabled: false },
  ]);
});

test("nega alteracao sem permissao antes de consultar o banco", async () => {
  let databaseCalled = false;
  const result = await setFundModuleVisibilityWithDependencies(
    { fundId: "fund-1", module: "CASH", enabled: true },
    {
      actorUserId: "user-1",
      canManage: false,
      findFund: async () => {
        databaseCalled = true;
        return { id: "fund-1" };
      },
      upsertVisibility: async () => {
        databaseCalled = true;
        return { enabled: true };
      },
      revalidate: () => undefined,
    }
  );

  assert.deepEqual(result, {
    ok: false,
    message: "Voce nao tem permissao para configurar modulos.",
  });
  assert.equal(databaseCalled, false);
});

test("valida o modulo e a existencia do fundo", async () => {
  const invalid = await setFundModuleVisibilityWithDependencies(
    { fundId: "fund-1", module: "UNKNOWN", enabled: true },
    {
      actorUserId: "user-1",
      canManage: true,
      findFund: async () => ({ id: "fund-1" }),
      upsertVisibility: async () => ({ enabled: true }),
      revalidate: () => undefined,
    }
  );
  assert.equal(invalid.ok, false);

  const missing = await setFundModuleVisibilityWithDependencies(
    { fundId: "missing", module: "DRE", enabled: true },
    {
      actorUserId: "user-1",
      canManage: true,
      findFund: async () => null,
      upsertVisibility: async () => ({ enabled: true }),
      revalidate: () => undefined,
    }
  );
  assert.deepEqual(missing, { ok: false, message: "Fundo nao encontrado." });
});

test("persiste a chave com auditoria e revalida todos os modulos", async () => {
  let captured: Record<string, unknown> | undefined;
  const paths: string[] = [];

  const result = await setFundModuleVisibilityWithDependencies(
    { fundId: "fund-1", module: "CASH", enabled: true },
    {
      actorUserId: "user-1",
      canManage: true,
      findFund: async () => ({ id: "fund-1" }),
      upsertVisibility: async (input) => {
        captured = input;
        return { enabled: input.enabled };
      },
      revalidate: (path) => paths.push(path),
    }
  );

  assert.deepEqual(captured, {
    fundId: "fund-1",
    module: "CASH",
    enabled: true,
    updatedByUserId: "user-1",
  });
  assert.deepEqual(result, {
    ok: true,
    message: "Modulo atualizado.",
    enabled: true,
  });
  assert.deepEqual(paths, [
    "/dashboard",
    "/dashboard/fundos",
    "/dashboard/caixa",
    "/dashboard/dre",
    "/dashboard/previsoes",
    "/dashboard/pdd",
  ]);
});

test("mantem o valor anterior quando a atualizacao falha", () => {
  assert.equal(
    resolveFundModuleToggle(true, { ok: false, message: "Falha" }),
    true
  );
  assert.equal(
    resolveFundModuleToggle(false, {
      ok: true,
      message: "Modulo atualizado.",
      enabled: true,
    }),
    true
  );
});
