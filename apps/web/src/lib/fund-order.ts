type FundLike = {
  name: string;
  shortName?: string | null;
};

function normalizeFundName(fund: FundLike) {
  return `${fund.shortName ?? ""} ${fund.name}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function fundDisplayPriority(fund: FundLike) {
  const label = normalizeFundName(fund);

  if (label.includes("APUAMA")) {
    return 0;
  }

  if (label.includes("BRISTOL")) {
    return 1;
  }

  if (label.includes("ANTENA")) {
    return 2;
  }

  if (label.includes("CONSIGNADO")) {
    return 3;
  }

  return 10;
}

export function sortFundsByDisplayPriority<T extends FundLike>(funds: T[]): T[] {
  return funds.slice().sort((left, right) => {
    const priorityDifference =
      fundDisplayPriority(left) - fundDisplayPriority(right);

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return (left.shortName || left.name).localeCompare(
      right.shortName || right.name,
      "pt-BR"
    );
  });
}

export function findDefaultFund<T extends FundLike & { id: string }>(
  funds: T[],
  requestedFundId?: string
) {
  return (
    funds.find((fund) => fund.id === requestedFundId) ??
    funds.find((fund) => fundDisplayPriority(fund) === 0) ??
    funds[0] ??
    null
  );
}
