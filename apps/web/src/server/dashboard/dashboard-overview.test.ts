import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardOverview } from "./dashboard-overview";

const fund = (id: string, integrated = true) => ({
  id,
  name: id,
  shortName: id,
  cnpj: `${id}-cnpj`,
  positionDate: new Date("2026-09-25T00:00:00.000Z"),
  totalPl: id === "APUAMA" ? 40_000_000 : 150_000_000,
  seniorValue: 1,
  mezzanineValue: 2,
  juniorValue: 3,
  dailyReturn: 0.1,
  monthReturn: 0.2,
  yearReturn: 0.3,
  monthlyReturnHistory: [],
  averageMonthlyRevenue: 10,
  averageMonthlyCost: 5,
  monthlyRevenueTotal: 100,
  monthlyCostTotal: 50,
  monthlyRevenuePeriods: 10,
  monthlyCostPeriods: 10,
  economicsStatus: "ready" as const,
  vopIntegrated: integrated,
});

const snapshot = (
  fundId: string,
  date: string,
  amount: string,
  options: { term?: string; rate?: string; calculated?: boolean } = {}
) => ({
  fundId,
  referenceDate: new Date(`${date}T00:00:00.000Z`),
  amount,
  operationCount: Number(amount) > 0 ? 1 : 0,
  termWeightedValue: options.term ?? null,
  termWeightAmount: options.term ? amount : null,
  monthlyRateWeightedValue: options.rate ?? null,
  monthlyRateWeightAmount: options.rate ? amount : null,
  indicatorsCalculatedAt:
    options.calculated === false ? null : new Date(`${date}T13:00:00.000Z`),
});

test("usa a última data comum para o VOP diário, mensal e por fundo", () => {
  const result = buildDashboardOverview({
    funds: [fund("APUAMA"), fund("BRISTOL")],
    snapshots: [
      snapshot("APUAMA", "2026-09-01", "10", { term: "100", rate: "0.2" }),
      snapshot("APUAMA", "2026-09-24", "100", { term: "3000", rate: "2" }),
      snapshot("APUAMA", "2026-09-25", "999", { term: "999", rate: "9.99" }),
      snapshot("BRISTOL", "2026-09-24", "200", { term: "8000", rate: "6" }),
    ],
  });

  assert.equal(result.vop.cutoffDate?.toISOString(), "2026-09-24T00:00:00.000Z");
  assert.equal(result.vop.dailyAmount, 300);
  assert.equal(result.vop.monthlyAmount, 310);
  assert.equal(result.funds.find((row) => row.id === "APUAMA")?.vop.dailyAmount, 100);
  assert.equal(result.funds.find((row) => row.id === "APUAMA")?.vop.monthlyAmount, 110);
  assert.equal(result.funds.find((row) => row.id === "BRISTOL")?.vop.termDays, 40);
});

test("distingue fundo sem operações, não integrado e indicador incompleto", () => {
  const result = buildDashboardOverview({
    funds: [fund("APUAMA"), fund("BRISTOL"), fund("ANTENA", false)],
    snapshots: [
      snapshot("APUAMA", "2026-09-24", "0"),
      snapshot("BRISTOL", "2026-09-24", "200", { calculated: false }),
    ],
  });

  assert.equal(result.funds[0].vop.status, "no_operations");
  assert.equal(result.funds[1].vop.status, "no_data");
  assert.equal(result.funds[2].vop.status, "not_integrated");
  assert.equal(result.vop.dailyAmount, 200);
  assert.equal(result.vop.monthlyAmount, 200);
  assert.equal(result.vop.integratedFunds, 2);
  assert.equal(result.vop.totalFunds, 3);
});

test("não soma datas incompatíveis quando não existe snapshot comum", () => {
  const result = buildDashboardOverview({
    funds: [fund("APUAMA"), fund("BRISTOL")],
    snapshots: [
      snapshot("APUAMA", "2026-09-25", "100"),
      snapshot("BRISTOL", "2026-09-24", "200"),
    ],
  });

  assert.equal(result.vop.status, "no_data");
  assert.equal(result.vop.cutoffDate, null);
  assert.equal(result.vop.dailyAmount, null);
  assert.equal(result.vop.monthlyAmount, null);
  assert.deepEqual(result.funds.map((row) => row.vop.status), ["no_data", "no_data"]);
});

test("mantém fundos sem posição visíveis sem contaminar o PL consolidado", () => {
  const unavailable = { ...fund("BRISTOL"), totalPl: null, positionDate: null };
  const result = buildDashboardOverview({
    funds: [fund("APUAMA"), unavailable],
    snapshots: [],
  });

  assert.equal(result.consolidatedPl, 40_000_000);
  assert.equal(result.activeFundCount, 2);
  assert.equal(result.funds[1].financialStatus, "no_data");
});
