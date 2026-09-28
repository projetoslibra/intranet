import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAndSortFunds,
  toggleExpandedFund,
} from "./fund-overview-state";
import type { DashboardFundRow } from "@/server/dashboard/dashboard-overview";

const row = (
  id: string,
  values: Partial<DashboardFundRow> = {}
): DashboardFundRow => ({
  id,
  name: id,
  shortName: id,
  cnpj: `${id}-cnpj`,
  positionDate: new Date("2026-09-24T00:00:00.000Z"),
  totalPl: 0,
  seniorValue: 0,
  mezzanineValue: 0,
  juniorValue: 0,
  dailyReturn: 0,
  monthReturn: 0,
  yearReturn: 0,
  averageMonthlyRevenue: 0,
  averageMonthlyCost: 0,
  monthlyRevenueTotal: 0,
  monthlyCostTotal: 0,
  monthlyRevenuePeriods: 0,
  monthlyCostPeriods: 0,
  economicsStatus: "ready",
  vopIntegrated: true,
  financialStatus: "ready",
  vop: {
    status: "ready",
    referenceDate: new Date("2026-09-24T00:00:00.000Z"),
    dailyAmount: 0,
    monthlyAmount: 0,
    termDays: 0,
    monthlyRate: 0,
  },
  ...values,
});

test("busca fundo por nome sem depender de acentos ou caixa", () => {
  const funds = [
    row("um", { name: "São Bento" }),
    row("dois", { name: "Bristol" }),
  ];

  assert.deepEqual(
    filterAndSortFunds(funds, "SAO", "name").map((fund) => fund.id),
    ["um"]
  );
});

test("ordena indicadores decrescentes e mantém valores ausentes por último", () => {
  const funds = [
    row("sem-dados", { totalPl: null }),
    row("menor", { totalPl: 10 }),
    row("maior", { totalPl: 30 }),
  ];

  assert.deepEqual(
    filterAndSortFunds(funds, "", "pl_desc").map((fund) => fund.id),
    ["maior", "menor", "sem-dados"]
  );
});

test("abre somente uma linha e recolhe a linha selecionada novamente", () => {
  assert.equal(toggleExpandedFund(null, "apuama"), "apuama");
  assert.equal(toggleExpandedFund("apuama", "bristol"), "bristol");
  assert.equal(toggleExpandedFund("bristol", "bristol"), null);
});
