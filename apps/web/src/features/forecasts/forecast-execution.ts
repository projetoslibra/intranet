export type ForecastSettlementMode = "D0" | "NEXT_BUSINESS_DAY";
export type OpenMovementPeriod = "MANHA" | "TARDE";
export type ForecastItemStatus =
  | "PENDING"
  | "AWAITING_MOVEMENT"
  | "IN_OPEN_MOVEMENT"
  | "AWAITING_STOCK"
  | "STOCK_CONFIRMED"
  | "DIVERGENT";

type TitleEvidence = {
  documentNumber: string | null;
  yourNumber: string | null;
  dueDate: string;
  nominalValue: number;
};

function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function nextBusinessDate(value: string) {
  const date = parseDateKey(value);

  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);

  return dateKey(date);
}

export function forecastImpactDate(
  executionDate: string,
  mode: ForecastSettlementMode
) {
  return mode === "D0" ? executionDate : nextBusinessDate(executionDate);
}

const saoPauloParts = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
});

export function saoPauloDateAndHour(value: Date) {
  const parts = Object.fromEntries(
    saoPauloParts
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

export function expectedOpenMovementSnapshot(executedAt: Date): {
  referenceDate: string;
  period: OpenMovementPeriod;
} {
  const local = saoPauloDateAndHour(executedAt);

  if (local.hour < 13) {
    return { referenceDate: local.date, period: "TARDE" };
  }

  return {
    referenceDate: nextBusinessDate(local.date),
    period: "MANHA",
  };
}

function normalizeIdentifier(value: string | null) {
  return value?.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() ?? "";
}

export function titleMatchesEvidence(
  planned: TitleEvidence,
  evidence: TitleEvidence
) {
  const plannedIdentifiers = new Set(
    [planned.documentNumber, planned.yourNumber]
      .map(normalizeIdentifier)
      .filter(Boolean)
  );
  const sameIdentifier = [evidence.documentNumber, evidence.yourNumber]
    .map(normalizeIdentifier)
    .some((identifier) => identifier && plannedIdentifiers.has(identifier));

  return (
    sameIdentifier &&
    planned.dueDate === evidence.dueDate &&
    Math.round(planned.nominalValue * 100) ===
      Math.round(evidence.nominalValue * 100)
  );
}

export function resolveForecastItemStatus(input: {
  executed: boolean;
  foundInOpenMovement: boolean;
  hasEligibleStockSnapshot: boolean;
  foundInStock: boolean;
  mode: ForecastSettlementMode;
}): ForecastItemStatus {
  if (!input.executed) {
    return "PENDING";
  }

  if (input.hasEligibleStockSnapshot) {
    return input.foundInStock ? "DIVERGENT" : "STOCK_CONFIRMED";
  }

  if (input.mode === "D0") {
    return "AWAITING_STOCK";
  }

  return input.foundInOpenMovement
    ? "IN_OPEN_MOVEMENT"
    : "AWAITING_MOVEMENT";
}

const monthFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

export function suggestedForecastName(periodEnd: string, version: number) {
  const formatted = monthFormatter.format(parseDateKey(periodEnd));
  const [month, year] = formatted.split(" de ");
  const capitalizedMonth = month
    ? `${month.charAt(0).toUpperCase()}${month.slice(1)}`
    : "";

  return `Fechamento ${capitalizedMonth}/${year} — v${version}`;
}

export function allocateReversalByNominal(
  titles: Array<{ id: string; nominalValue: number }>,
  reversalValue: number
) {
  const result: Record<string, number> = {};
  const totalNominal = titles.reduce(
    (total, title) => total + Math.max(0, title.nominalValue),
    0
  );

  titles.forEach((title, index) => {
    const allocatedBefore = Object.values(result).reduce(
      (total, value) => total + value,
      0
    );
    result[title.id] =
      index === titles.length - 1
        ? reversalValue - allocatedBefore
        : reversalValue *
          (totalNominal > 0
            ? Math.max(0, title.nominalValue) / totalNominal
            : 1 / titles.length);
  });

  return result;
}
