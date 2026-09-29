import type { DashboardFundRow } from "@/server/dashboard/dashboard-overview";

export type FundSortMode =
  | "name"
  | "pl_desc"
  | "daily_vop_desc"
  | "monthly_vop_desc"
  | "monthly_return_desc";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function compareNullableDescending(
  left: number | null,
  right: number | null
) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

export function filterAndSortFunds(
  funds: DashboardFundRow[],
  query: string,
  sortMode: FundSortMode
) {
  const normalizedQuery = normalize(query.trim());
  const filtered = normalizedQuery
    ? funds.filter((fund) =>
        normalize(`${fund.name} ${fund.shortName} ${fund.cnpj}`).includes(
          normalizedQuery
        )
      )
    : funds.slice();

  return filtered.sort((left, right) => {
    let difference = 0;
    if (sortMode === "pl_desc") {
      difference = compareNullableDescending(left.totalPl, right.totalPl);
    } else if (sortMode === "daily_vop_desc") {
      difference = compareNullableDescending(
        left.vop.dailyAmount,
        right.vop.dailyAmount
      );
    } else if (sortMode === "monthly_vop_desc") {
      difference = compareNullableDescending(
        left.vop.monthlyAmount,
        right.vop.monthlyAmount
      );
    } else if (sortMode === "monthly_return_desc") {
      difference = compareNullableDescending(
        left.financialStatus === "ready" ? left.monthReturn : null,
        right.financialStatus === "ready" ? right.monthReturn : null
      );
    }

    return (
      difference ||
      (left.shortName || left.name).localeCompare(
        right.shortName || right.name,
        "pt-BR"
      )
    );
  });
}

export function initialExpandedFundIds(_fundIds: string[]) {
  return [];
}

export function toggleExpandedFund(
  currentFundIds: string[],
  selectedFundId: string
) {
  return currentFundIds.includes(selectedFundId)
    ? currentFundIds.filter((fundId) => fundId !== selectedFundId)
    : [...currentFundIds, selectedFundId];
}

export function allFundsExpanded(
  currentFundIds: string[],
  fundIds: string[]
) {
  return fundIds.length > 0 && fundIds.every((fundId) => currentFundIds.includes(fundId));
}

export function toggleAllFunds(currentFundIds: string[], fundIds: string[]) {
  return allFundsExpanded(currentFundIds, fundIds) ? [] : fundIds.slice();
}
