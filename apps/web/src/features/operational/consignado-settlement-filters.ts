export const settlementOriginatorCodes = ["GIBB", "JUCA", "BANKERIZE", "UY3"] as const;
export type SettlementOriginatorCode = (typeof settlementOriginatorCodes)[number];

export type SettlementWorkspaceFilters = {
  createdDate?: string;
  originator?: SettlementOriginatorCode | string;
};

export type NormalizedSettlementWorkspaceFilters = {
  createdDate?: string;
  originator?: SettlementOriginatorCode;
};

export function normalizeSettlementWorkspaceFilters(
  input: SettlementWorkspaceFilters,
): NormalizedSettlementWorkspaceFilters {
  const createdDate = input.createdDate?.trim();
  const originator = input.originator?.trim().toUpperCase();
  if (originator && !settlementOriginatorCodes.includes(originator as SettlementOriginatorCode)) {
    throw new Error("Originador inválido.");
  }

  return {
    ...(createdDate ? { createdDate } : {}),
    ...(originator ? { originator: originator as SettlementOriginatorCode } : {}),
  };
}

export function buildSettlementWorkspaceQuery(input: SettlementWorkspaceFilters) {
  const filters = normalizeSettlementWorkspaceFilters(input);
  const params = new URLSearchParams();
  if (filters.createdDate) params.set("createdDate", filters.createdDate);
  if (filters.originator) params.set("originator", filters.originator);
  const query = params.toString();
  return query ? `?${query}` : "";
}
