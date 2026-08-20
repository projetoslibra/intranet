export type DifferenceDirection = "ENTRY_EXCESS" | "REMITTANCE_EXCESS";

export type RemittanceExclusionCategory =
  | "NOT_FOUND_IN_STOCK"
  | "OPERATOR_EXCLUDED"
  | "NOT_APPROVED"
  | "PDD_RECOVERY"
  | "OTHER_DIVERGENCE";

export type OtherDifferenceCategory =
  | "BANK_FEE"
  | "UNIDENTIFIED_CREDIT"
  | "VALUE_DIFFERENCE"
  | "ROUNDING"
  | "TIMING_DIFFERENCE"
  | "OTHER";

export type EligibleExclusion = {
  id: string;
  remittanceId: string;
  remittanceFileName: string;
  batchFileName: string;
  contractNumber: string | null;
  debtorName: string | null;
  debtorDocument: string | null;
  dueDate: string | null;
  titleAmount: string;
  paidAmount: string;
  category: RemittanceExclusionCategory;
  reason: string;
};

export type OtherDifferenceDraft = {
  category: OtherDifferenceCategory | "";
  amount: string;
  reason: string;
};

type ComposeDifferenceStateInput = {
  difference: number;
  direction: DifferenceDirection;
  exclusions: EligibleExclusion[];
  selectedIds: string[];
  otherDifferences: OtherDifferenceDraft[];
};

function amountToCents(value: string | number) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function centsToAmount(value: number) {
  return value / 100;
}

export function composeDifferenceState(input: ComposeDifferenceStateInput) {
  const differenceCents = amountToCents(input.difference) ?? 0;
  const exclusionsById = new Map(input.exclusions.map((item) => [item.id, item]));
  const selectedIds = Array.from(new Set(input.selectedIds));
  const hasUnknownSelectedIds = selectedIds.some((id) => !exclusionsById.has(id));
  const titleCents = selectedIds.reduce((total, id) => {
    const exclusion = exclusionsById.get(id);
    return total + (exclusion ? amountToCents(exclusion.paidAmount) ?? 0 : 0);
  }, 0);
  let hasIncompleteOtherDifference = false;
  const otherCents = input.otherDifferences.reduce((total, item) => {
    const amountCents = amountToCents(item.amount);
    if (!item.category || amountCents === null || amountCents <= 0 || item.reason.trim().length < 5) {
      hasIncompleteOtherDifference = true;
    }
    return total + (amountCents ?? 0);
  }, 0);
  const unexplainedCents = differenceCents - titleCents - otherCents;
  const hasTitleOverflow = titleCents > differenceCents;
  const hasOtherOverflow = titleCents + otherCents > differenceCents;
  const hasDisallowedTitles = input.direction === "REMITTANCE_EXCESS" && selectedIds.length > 0;
  const canSubmit = unexplainedCents === 0
    && !hasTitleOverflow
    && !hasOtherOverflow
    && !hasIncompleteOtherDifference
    && !hasDisallowedTitles
    && !hasUnknownSelectedIds;

  return {
    titleTotal: centsToAmount(titleCents),
    otherTotal: centsToAmount(otherCents),
    unexplained: centsToAmount(unexplainedCents),
    hasTitleOverflow,
    hasOtherOverflow,
    hasIncompleteOtherDifference,
    hasDisallowedTitles,
    hasUnknownSelectedIds,
    canSubmit,
  };
}
