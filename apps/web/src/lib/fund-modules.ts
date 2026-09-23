export const FUND_MODULES = [
  { key: "DASHBOARD", label: "Dashboard" },
  { key: "CASH", label: "Caixa" },
  { key: "DRE", label: "DRE" },
  { key: "FORECASTS", label: "Previsões" },
  { key: "PDD", label: "PDD" },
] as const;

export type FundModuleKey = (typeof FUND_MODULES)[number]["key"];
export type FundModuleVisibilityMap = Record<FundModuleKey, boolean>;

export type FundModuleRow = {
  module: string;
  enabled: boolean;
};

export function fundEnabledFor(module: FundModuleKey) {
  return {
    status: "ACTIVE" as const,
    moduleVisibilities: {
      some: {
        module,
        enabled: true,
      },
    },
  };
}

export function fundListWhere(module: FundModuleKey) {
  return {
    ...fundEnabledFor(module),
    cnpj: {
      not: "00.000.000/0001-00",
    },
  };
}

export function normalizeFundModules(
  rows: readonly FundModuleRow[]
): FundModuleVisibilityMap {
  const modules: FundModuleVisibilityMap = {
    DASHBOARD: false,
    CASH: false,
    DRE: false,
    FORECASTS: false,
    PDD: false,
  };

  for (const row of rows) {
    if (FUND_MODULES.some((module) => module.key === row.module)) {
      modules[row.module as FundModuleKey] = row.enabled;
    }
  }

  return modules;
}
