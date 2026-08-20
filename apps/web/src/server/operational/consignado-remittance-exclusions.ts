import { Prisma, type RemittanceExclusionCategory, type SettlementItemStatus } from "@prisma/client";

type MoneySnapshot = Prisma.Decimal;
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

export type RemittanceSelectionItem = RemittanceExclusionItem & {
  occurrence: string | null;
  matchedStockPosition: { nominalValue: Prisma.Decimal } | null;
};

const MATCHABLE_STATUSES = new Set<SettlementItemStatus>(["FULL_MATCH", "PARTIAL_MATCH", "MANUALLY_MATCHED"]);

function isUnderpaid77(item: RemittanceSelectionItem) {
  if (item.occurrence !== "77" || item.status !== "DIVERGENT" || !item.matchedStockPosition) return false;
  const nominal = item.matchedStockPosition.nominalValue;
  return nominal.gt(0) && item.paidAmount.gt(0) && item.paidAmount.lt(nominal);
}

export function selectRemittanceItems<T extends RemittanceSelectionItem>(items: T[]) {
  return items.filter((item): item is T & { matchedStockPosition: NonNullable<T["matchedStockPosition"]> } =>
    item.approved && Boolean(item.matchedStockPosition) && (MATCHABLE_STATUSES.has(item.status) || isUnderpaid77(item))
  );
}

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

export function buildRemittanceExclusionPersistence(
  remittanceId: string,
  allItems: RemittanceExclusionItem[],
  includedItems: Array<Pick<RemittanceExclusionItem, "id">>,
) {
  const includedIds = new Set(includedItems.map((item) => item.id));
  const exclusions = buildRemittanceExclusions(remittanceId, allItems, includedIds);
  const excludedPaidAmount = exclusions.reduce((sum, exclusion) => sum.add(exclusion.paidAmount), new Prisma.Decimal(0));
  const excludedItems = exclusions.length;

  return {
    includedIds,
    exclusions,
    excludedItems,
    excludedPaidAmount,
    metadata: { excludedItems, excludedPaidAmount: excludedPaidAmount.toString() },
  };
}
