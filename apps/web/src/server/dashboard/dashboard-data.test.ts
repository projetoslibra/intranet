import assert from "node:assert/strict";
import test from "node:test";
import { loadDashboardOverview, type DashboardDataRepository } from "./dashboard-data";

test("carrega fontes em lote e mantém os fundos quando uma fonte secundária falha", async () => {
  const calls = {
    funds: 0,
    latestDates: 0,
    carteiras: 0,
    caixas: 0,
    snapshots: 0,
  };
  const repository: DashboardDataRepository = {
    async listDashboardFunds() {
      calls.funds += 1;
      return [
        { id: "apuama", name: "Apuama", shortName: "Apuama", cnpj: "1" },
        { id: "bristol", name: "Bristol", shortName: "Bristol", cnpj: "2" },
        { id: "antena", name: "Antena", shortName: "Antena", cnpj: "3" },
      ];
    },
    async listLatestCarteiraDates() {
      calls.latestDates += 1;
      return [
        { fundKey: "APUAMA", referenceDate: new Date("2026-09-25T00:00:00.000Z") },
        { fundKey: "BRISTOL", referenceDate: new Date("2026-09-24T00:00:00.000Z") },
      ];
    },
    async listCarteirasForRanges() {
      calls.carteiras += 1;
      return [
        { fundKey: "APUAMA", referenceDate: new Date("2026-09-01T00:00:00.000Z"), ativo: "Variação Mensal", valor: "0.25" },
        { fundKey: "APUAMA", referenceDate: new Date("2026-09-15T00:00:00.000Z"), ativo: "Variação Mensal", valor: "1.5" },
        { fundKey: "APUAMA", referenceDate: new Date("2026-09-25T00:00:00.000Z"), ativo: "SRP", valor: "60" },
        { fundKey: "APUAMA", referenceDate: new Date("2026-09-25T00:00:00.000Z"), ativo: "MEZAN", valor: "30" },
        { fundKey: "APUAMA", referenceDate: new Date("2026-09-25T00:00:00.000Z"), ativo: "PATRIMONIO", valor: "10" },
        { fundKey: "APUAMA", referenceDate: new Date("2026-09-25T00:00:00.000Z"), ativo: "Variação Mensal", valor: "2.75" },
        { fundKey: "BRISTOL", referenceDate: new Date("2026-09-24T00:00:00.000Z"), ativo: "SRP", valor: "150" },
      ];
    },
    async listCaixasForRanges() {
      calls.caixas += 1;
      throw new Error("fonte de caixa temporariamente indisponível");
    },
    async listVopSnapshots() {
      calls.snapshots += 1;
      return [
        {
          fundId: "apuama",
          referenceDate: new Date("2026-09-24T00:00:00.000Z"),
          amount: "100",
          operationCount: 1,
          termWeightedValue: "3000",
          termWeightAmount: "100",
          monthlyRateWeightedValue: "2",
          monthlyRateWeightAmount: "100",
          indicatorsCalculatedAt: new Date("2026-09-24T13:00:00.000Z"),
        },
        {
          fundId: "bristol",
          referenceDate: new Date("2026-09-24T00:00:00.000Z"),
          amount: "200",
          operationCount: 1,
          termWeightedValue: "8000",
          termWeightAmount: "200",
          monthlyRateWeightedValue: "6",
          monthlyRateWeightAmount: "200",
          indicatorsCalculatedAt: new Date("2026-09-24T13:00:00.000Z"),
        },
      ];
    },
  };

  const result = await loadDashboardOverview({ repository });

  assert.deepEqual(calls, {
    funds: 1,
    latestDates: 1,
    carteiras: 1,
    caixas: 1,
    snapshots: 1,
  });
  assert.equal(result.activeFundCount, 3);
  assert.equal(result.consolidatedPl, 250);
  assert.equal(result.vop.dailyAmount, 300);
  assert.equal(result.funds.find((fund) => fund.id === "antena")?.financialStatus, "no_data");
  assert.equal(result.funds.find((fund) => fund.id === "apuama")?.economicsStatus, "no_data");
  assert.equal(result.funds.find((fund) => fund.id === "apuama")?.averageMonthlyRevenue, 0);
  assert.deepEqual(
    result.funds.find((fund) => fund.id === "apuama")?.monthlyReturnHistory,
    [
      { referenceDate: new Date("2026-09-01T00:00:00.000Z"), value: 0.25 },
      { referenceDate: new Date("2026-09-15T00:00:00.000Z"), value: 1.5 },
      { referenceDate: new Date("2026-09-25T00:00:00.000Z"), value: 2.75 },
    ]
  );
});
