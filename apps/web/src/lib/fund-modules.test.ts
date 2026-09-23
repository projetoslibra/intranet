import assert from "node:assert/strict";
import test from "node:test";
import {
  fundEnabledFor,
  fundListWhere,
  normalizeFundModules,
} from "./fund-modules";

test("exige status ativo e habilitação explícita do módulo solicitado", () => {
  assert.deepEqual(fundEnabledFor("CASH"), {
    status: "ACTIVE",
    moduleVisibilities: {
      some: {
        module: "CASH",
        enabled: true,
      },
    },
  });
});

test("não reutiliza o mesmo filtro mutável entre consultas", () => {
  const cash = fundEnabledFor("CASH");
  const dre = fundEnabledFor("DRE");

  assert.notEqual(cash, dre);
  assert.deepEqual(dre, {
    status: "ACTIVE",
    moduleVisibilities: {
      some: {
        module: "DRE",
        enabled: true,
      },
    },
  });
});

test("trata configurações ausentes como módulos desligados", () => {
  assert.deepEqual(
    normalizeFundModules([{ module: "CASH", enabled: true }]),
    {
      DASHBOARD: false,
      CASH: true,
      DRE: false,
      FORECASTS: false,
      PDD: false,
    }
  );
});

test("aplica o último valor persistido de cada módulo sem contaminar os demais", () => {
  assert.deepEqual(
    normalizeFundModules([
      { module: "DASHBOARD", enabled: true },
      { module: "CASH", enabled: false },
      { module: "PDD", enabled: true },
    ]),
    {
      DASHBOARD: true,
      CASH: false,
      DRE: false,
      FORECASTS: false,
      PDD: true,
    }
  );
});

test("exclui o fundo placeholder da lista de cada módulo", () => {
  assert.deepEqual(fundListWhere("PDD"), {
    status: "ACTIVE",
    cnpj: { not: "00.000.000/0001-00" },
    moduleVisibilities: {
      some: { module: "PDD", enabled: true },
    },
  });
});
