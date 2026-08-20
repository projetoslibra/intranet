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

export function recoverDifferenceCompositionAfterRejection(_current: {
  selectedIds: string[];
  otherDifferences: OtherDifferenceDraft[];
  showComposer: boolean;
}) {
  return {
    selectedIds: [] as string[],
    otherDifferences: [] as OtherDifferenceDraft[],
    showComposer: false,
  };
}

type ComposeDifferenceStateInput = {
  difference: string;
  direction: DifferenceDirection;
  exclusions: EligibleExclusion[];
  selectedIds: string[];
  otherDifferences: OtherDifferenceDraft[];
};

const ZERO_CENTS = BigInt(0);
const HUNDRED_CENTS = BigInt(100);
const TEN = BigInt(10);
const MAX_DECIMAL_CENTS = BigInt("999999999999999999999999");

export function decimalAmountToCents(value: string) {
  const input = value.trim();
  const expanded = /^(0|[1-9]\d{0,21})(?:\.(\d{1,2}))?$/.exec(input);
  if (expanded) {
    return BigInt(expanded[1]) * HUNDRED_CENTS + BigInt((expanded[2] ?? "").padEnd(2, "0"));
  }

  const scientific = /^(0|[1-9]\d*)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(input);
  if (!scientific) return null;
  const fraction = scientific[2] ?? "";
  const coefficientDigits = `${scientific[1]}${fraction}`.replace(/^0+/, "");
  if (!coefficientDigits) return ZERO_CENTS;

  const coefficient = BigInt(coefficientDigits);
  const exponent = BigInt(scientific[3]);
  const centShift = exponent - BigInt(fraction.length) + BigInt(2);
  let cents: bigint;
  if (centShift >= ZERO_CENTS) {
    if (BigInt(coefficientDigits.length) + centShift > BigInt(24)) return null;
    cents = coefficient * (TEN ** centShift);
  } else {
    const divisorPower = -centShift;
    if (divisorPower > BigInt(coefficientDigits.length)) return null;
    const divisor = TEN ** divisorPower;
    if (coefficient % divisor !== ZERO_CENTS) return null;
    cents = coefficient / divisor;
  }
  return cents <= MAX_DECIMAL_CENTS ? cents : null;
}

export function centsToDecimalAmount(value: bigint) {
  const sign = value < ZERO_CENTS ? "-" : "";
  const absolute = value < ZERO_CENTS ? -value : value;
  return `${sign}${absolute / HUNDRED_CENTS}.${String(absolute % HUNDRED_CENTS).padStart(2, "0")}`;
}

export function formatCentsAsBRL(value: bigint) {
  const sign = value < ZERO_CENTS ? "-" : "";
  const absolute = value < ZERO_CENTS ? -value : value;
  const integer = String(absolute / HUNDRED_CENTS).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$\u00a0${integer},${String(absolute % HUNDRED_CENTS).padStart(2, "0")}`;
}

function canonicalDecimal(integer: string, fraction = "") {
  const result = `${integer}.${fraction.padEnd(2, "0") || "00"}`;
  return decimalAmountToCents(result) === null ? null : result;
}

export function normalizePtBrMoneyInput(value: string) {
  let input = value.trim().replace(/\u00a0/g, " ");
  if (input.startsWith("R$")) input = input.slice(2).trim();
  if (!input || /\s/.test(input)) return null;

  if (input.includes(",")) {
    const match = /^([^,]+),(\d{1,2})$/.exec(input);
    if (!match) return null;
    const integer = match[1];
    const ungrouped = /^(0|[1-9]\d*)$/.test(integer);
    const grouped = /^[1-9]\d{0,2}(?:\.\d{3})+$/.test(integer);
    if (!ungrouped && !grouped) return null;
    return canonicalDecimal(integer.replace(/\./g, ""), match[2]);
  }

  const canonical = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(input);
  if (canonical) return canonicalDecimal(canonical[1], canonical[2]);
  if (/^[1-9]\d{0,2}(?:\.\d{3})+$/.test(input)) {
    return canonicalDecimal(input.replace(/\./g, ""));
  }
  return null;
}

export function normalizeOtherDifferencesForPayload(items: OtherDifferenceDraft[]) {
  return items.map((item) => {
    const amount = normalizePtBrMoneyInput(item.amount);
    if (amount === null) throw new Error("Informe um valor monetário válido.");
    return { ...item, amount };
  });
}

function requiredDecimalCents(value: string) {
  const cents = decimalAmountToCents(value);
  if (cents === null) throw new Error(`Valor monetário inválido: ${value}`);
  return cents;
}

type BalanceSnapshot = {
  amount: string;
  allocatedAmount: string;
  adjustedAmount: string;
};

function remainingBalanceCents(item: BalanceSnapshot) {
  return requiredDecimalCents(item.amount)
    - requiredDecimalCents(item.allocatedAmount)
    - requiredDecimalCents(item.adjustedAmount);
}

export function calculateDifferenceSelection(input: {
  entries: BalanceSnapshot[];
  remittances: BalanceSnapshot[];
}) {
  const entryTotalCents = input.entries.reduce((total, item) => total + remainingBalanceCents(item), ZERO_CENTS);
  const remittanceTotalCents = input.remittances.reduce((total, item) => total + remainingBalanceCents(item), ZERO_CENTS);
  const signedDifferenceCents = entryTotalCents - remittanceTotalCents;
  const differenceCents = signedDifferenceCents < ZERO_CENTS ? -signedDifferenceCents : signedDifferenceCents;
  return {
    entryTotalCents,
    remittanceTotalCents,
    differenceCents,
    difference: centsToDecimalAmount(differenceCents),
    direction: signedDifferenceCents >= ZERO_CENTS ? "ENTRY_EXCESS" as const : "REMITTANCE_EXCESS" as const,
  };
}

export function composeDifferenceState(input: ComposeDifferenceStateInput) {
  const parsedDifferenceCents = decimalAmountToCents(input.difference);
  const differenceCents = parsedDifferenceCents ?? ZERO_CENTS;
  const exclusionsById = new Map(input.exclusions.map((item) => [item.id, item]));
  const selectedIds = Array.from(new Set(input.selectedIds));
  const hasUnknownSelectedIds = selectedIds.some((id) => !exclusionsById.has(id));
  let hasInvalidSelectedAmount = false;
  const titleCents = selectedIds.reduce((total, id) => {
    const exclusion = exclusionsById.get(id);
    if (!exclusion) return total;
    const cents = decimalAmountToCents(exclusion.paidAmount);
    if (cents === null) hasInvalidSelectedAmount = true;
    return total + (cents ?? ZERO_CENTS);
  }, ZERO_CENTS);
  let hasIncompleteOtherDifference = false;
  const otherCents = input.otherDifferences.reduce((total, item) => {
    const normalizedAmount = normalizePtBrMoneyInput(item.amount);
    const amountCents = normalizedAmount === null ? null : decimalAmountToCents(normalizedAmount);
    if (!item.category || amountCents === null || amountCents <= ZERO_CENTS || item.reason.trim().length < 5) {
      hasIncompleteOtherDifference = true;
    }
    return total + (amountCents ?? ZERO_CENTS);
  }, ZERO_CENTS);
  const unexplainedCents = differenceCents - titleCents - otherCents;
  const hasTitleOverflow = titleCents > differenceCents;
  const hasOtherOverflow = titleCents + otherCents > differenceCents;
  const hasDisallowedTitles = input.direction === "REMITTANCE_EXCESS" && selectedIds.length > 0;
  const canSubmit = parsedDifferenceCents !== null
    && unexplainedCents === ZERO_CENTS
    && !hasTitleOverflow
    && !hasOtherOverflow
    && !hasIncompleteOtherDifference
    && !hasDisallowedTitles
    && !hasUnknownSelectedIds
    && !hasInvalidSelectedAmount;

  return {
    titleTotal: centsToDecimalAmount(titleCents),
    otherTotal: centsToDecimalAmount(otherCents),
    unexplained: centsToDecimalAmount(unexplainedCents),
    titleTotalCents: titleCents,
    otherTotalCents: otherCents,
    unexplainedCents,
    hasTitleOverflow,
    hasOtherOverflow,
    hasIncompleteOtherDifference,
    hasDisallowedTitles,
    hasUnknownSelectedIds,
    hasInvalidSelectedAmount,
    canSubmit,
  };
}
