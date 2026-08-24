// lógica pdd: regra oficial de PDD por sacado usada nas simulacoes do OSHER.
export type LogicaPddTitle = {
  id: string;
  debtorName: string;
  debtorDocument: string | null;
  originalDueDate: string;
  presentValue: number;
  pddValue: number;
};

export type PddReversalSimulation = {
  currentPdd: number;
  newPdd: number;
  reversalValue: number;
  affectedDebtors: number;
};

export const PDD_RANGES = [
  { code: "A", maxDaysLate: 5, rate: 0, label: "A - até 5 dias" },
  { code: "B", maxDaysLate: 30, rate: 0.0143, label: "B - 6 a 30 dias" },
  { code: "C", maxDaysLate: 60, rate: 0.1406, label: "C - 31 a 60 dias" },
  { code: "D", maxDaysLate: 90, rate: 0.4659, label: "D - 61 a 90 dias" },
  { code: "E", maxDaysLate: 120, rate: 0.8031, label: "E - 91 a 120 dias" },
  { code: "F", maxDaysLate: Number.POSITIVE_INFINITY, rate: 1, label: "F - acima de 120 dias" },
] as const;

function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function pddDebtorKey(
  title: Pick<LogicaPddTitle, "debtorDocument" | "debtorName">
) {
  return title.debtorDocument || title.debtorName;
}

export function pddRateForDelay(daysLate: number) {
  return PDD_RANGES.find((range) => daysLate <= range.maxDaysLate)?.rate ?? 1;
}

export function pddRangeLabelForDelay(daysLate: number) {
  return (
    PDD_RANGES.find((range) => daysLate <= range.maxDaysLate)?.label ??
    PDD_RANGES[PDD_RANGES.length - 1].label
  );
}

export function pddDaysLate(referenceDate: string, dueDate: string) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const diff =
    parseDateKey(referenceDate).getTime() - parseDateKey(dueDate).getTime();

  return Math.max(0, Math.floor(diff / millisecondsPerDay));
}

export function calculateDebtorPddAfterReduction(
  referenceDate: string,
  titles: LogicaPddTitle[],
  selectedTitleIds: Set<string>
) {
  const remainingTitles = titles.filter((title) => !selectedTitleIds.has(title.id));

  if (remainingTitles.length === 0) {
    return 0;
  }

  const maxDelay = Math.max(
    ...remainingTitles.map((title) =>
      pddDaysLate(referenceDate, title.originalDueDate)
    )
  );
  const rate = pddRateForDelay(maxDelay);

  return remainingTitles.reduce(
    (total, title) => total + title.presentValue * rate,
    0
  );
}

export function calculatePddReversalSimulation(
  referenceDate: string,
  allTitles: LogicaPddTitle[],
  selectedTitles: LogicaPddTitle[],
  selectedTitleIds: Set<string>
): PddReversalSimulation {
  if (selectedTitles.length === 0) {
    return {
      currentPdd: 0,
      newPdd: 0,
      reversalValue: 0,
      affectedDebtors: 0,
    };
  }

  const affectedDebtorKeys = new Set(selectedTitles.map(pddDebtorKey));
  let currentPdd = 0;
  let newPdd = 0;

  affectedDebtorKeys.forEach((key) => {
    const debtorTitles = allTitles.filter((title) => pddDebtorKey(title) === key);
    currentPdd += debtorTitles.reduce((total, title) => total + title.pddValue, 0);
    newPdd += calculateDebtorPddAfterReduction(
      referenceDate,
      debtorTitles,
      selectedTitleIds
    );
  });

  return {
    currentPdd,
    newPdd,
    reversalValue: Math.max(0, currentPdd - newPdd),
    affectedDebtors: affectedDebtorKeys.size,
  };
}
