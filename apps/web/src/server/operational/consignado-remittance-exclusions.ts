import type { Prisma, RemittanceExclusionCategory, SettlementItemStatus } from "@prisma/client";

type MoneySnapshot = Prisma.Decimal | string | number;
type RemittanceExclusionSnapshot = Omit<Prisma.ConsignadoRemittanceExclusionCreateManyInput, "paidAmount" | "titleAmount"> & {
  paidAmount: MoneySnapshot;
  titleAmount: MoneySnapshot;
};

export type RemittanceExclusionItem = {
  id: string;
  status: SettlementItemStatus;
  matchedStockPositionId: string | null;
  approved: boolean;
  exclusionReason: string | null;
  statusReason: string | null;
  paidAmount: MoneySnapshot;
  titleAmount: MoneySnapshot;
};

function isPddRecovery(status: SettlementItemStatus) {
  return status === "PDD_RECOVERY" || status === "PDD_REVIEW";
}

function isNotFoundInStock(item: RemittanceExclusionItem) {
  return item.matchedStockPositionId === null && item.statusReason?.toLocaleLowerCase("pt-BR").includes("não encontrado");
}

function isOperatorExclusion(reason: string | null) {
  return reason !== null && !reason.toLocaleLowerCase("pt-BR").includes("não incluído na remessa aprovada");
}

export function classifyRemittanceExclusion(item: RemittanceExclusionItem): RemittanceExclusionCategory {
  if (isPddRecovery(item.status)) return "PDD_RECOVERY";
  if (isNotFoundInStock(item)) return "NOT_FOUND_IN_STOCK";
  if (isOperatorExclusion(item.exclusionReason)) return "OPERATOR_EXCLUDED";
  if (!item.approved) return "NOT_APPROVED";
  return "OTHER_DIVERGENCE";
}

export function buildRemittanceExclusions(
  remittanceId: string,
  allItems: RemittanceExclusionItem[],
  includedIds: Set<string>,
): RemittanceExclusionSnapshot[] {
  return allItems
    .filter((item) => !includedIds.has(item.id))
    .map((item) => ({
      remittanceId,
      settlementItemId: item.id,
      category: classifyRemittanceExclusion(item),
      reason: item.exclusionReason ?? item.statusReason ?? "Não incluído na remessa.",
      paidAmount: item.paidAmount,
      titleAmount: item.titleAmount,
    }));
}
