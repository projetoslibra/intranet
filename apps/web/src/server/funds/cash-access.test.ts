import assert from "node:assert/strict";
import test from "node:test";
import { validateCashFundIdsWithDependencies } from "./cash-access";

test("aceita somente quando todos os fundos solicitados estao habilitados no Caixa", async () => {
  let requestedIds: string[] = [];
  const result = await validateCashFundIdsWithDependencies(
    ["fund-1", "fund-2", "fund-1"],
    async (fundIds) => {
      requestedIds = fundIds;
      return ["fund-1", "fund-2"];
    }
  );

  assert.deepEqual(requestedIds, ["fund-1", "fund-2"]);
  assert.deepEqual(result, { ok: true });
});

test("rejeita o lote inteiro quando algum fundo nao esta habilitado no Caixa", async () => {
  const result = await validateCashFundIdsWithDependencies(
    ["fund-1", "fund-disabled"],
    async () => ["fund-1"]
  );

  assert.deepEqual(result, {
    ok: false,
    message: "Um ou mais fundos nao estao habilitados no Caixa.",
  });
});

test("rejeita uma lista vazia", async () => {
  const result = await validateCashFundIdsWithDependencies([], async () => []);
  assert.equal(result.ok, false);
});
