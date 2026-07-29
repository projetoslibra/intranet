"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Info, Trash2 } from "lucide-react";
import {
  calculateDebtorPddAfterReduction,
  pddDebtorKey,
  type LogicaPddTitle,
} from "@/lib/logica-pdd";

type FundOption = {
  id: string;
  name: string;
  shortName: string;
};

type HistoricalRow = {
  date: string;
  patrimonio: number;
  creditRights: number;
  creditRightsVariation: number;
  costVariation: number;
  pdd: number;
  variacaoMensal: number;
  variacaoAnual: number;
};

type ForecastInput = {
  pddDelta: number;
};

type ForecastStockTitle = LogicaPddTitle & {
  cedentName: string;
  cedentDocument: string | null;
  documentNumber: string;
  nominalValue: number;
  pddRange: string | null;
  situation: string | null;
};

type ForecastStockData = {
  fundName: string;
  latestDate: string;
  cedents: Array<{
    name: string;
    document: string | null;
    titleCount: number;
    nominalValue: number;
    pddValue: number;
  }>;
  titles: ForecastStockTitle[];
} | null;

type PddCompositionItem = {
  label: string;
  value: number;
  detail?: string;
};

type QuotaForecastPlannerProps = {
  funds: FundOption[];
  selectedFundId: string;
  historicalRows: HistoricalRow[];
  baseShareQuantity: number;
  stockData: ForecastStockData;
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const decimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
});

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function isBusinessDay(value: Date) {
  const day = value.getUTCDay();
  return day !== 0 && day !== 6;
}

function nextBusinessDay(value: Date) {
  let date = addDays(value, 1);

  while (!isBusinessDay(date)) {
    date = addDays(date, 1);
  }

  return date;
}

function buildFutureDates(startKey: string | null, endKey: string) {
  if (!startKey || !endKey) {
    return [];
  }

  const result: string[] = [];
  let cursor = nextBusinessDay(parseDateKey(startKey));
  const end = parseDateKey(endKey);

  while (cursor <= end) {
    if (isBusinessDay(cursor)) {
      result.push(dateKey(cursor));
    }

    cursor = addDays(cursor, 1);
  }

  return result;
}

function formatDate(value: string) {
  return dateFormatter.format(parseDateKey(value));
}

function toInputNumber(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function formatSignedCurrency(value: number) {
  if (Math.abs(value) < 0.005) {
    return currencyFormatter.format(0);
  }

  return `${value > 0 ? "+" : ""}${currencyFormatter.format(value)}`;
}

function formatInputNumber(value: number | undefined) {
  if (!value || Math.abs(value) < 0.005) {
    return "";
  }

  return String(value).replace(".", ",");
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function sortPddItems(items: PddCompositionItem[]) {
  return [...items].sort(
    (left, right) => Math.abs(right.value) - Math.abs(left.value)
  );
}

function sumPddItems(items: PddCompositionItem[]) {
  return items.reduce((total, item) => total + item.value, 0);
}

function mergePddItems(items: PddCompositionItem[]) {
  const groups = new Map<string, PddCompositionItem>();

  items.forEach((item) => {
    const key = `${item.label}|${item.detail ?? ""}`;
    const current = groups.get(key) ?? { ...item, value: 0 };

    current.value += item.value;
    groups.set(key, current);
  });

  return sortPddItems(Array.from(groups.values()));
}

function groupTitlesByCedent(
  titles: ForecastStockTitle[],
  sign: 1 | -1 = 1
) {
  const groups = new Map<string, PddCompositionItem>();

  titles.forEach((title) => {
    const current = groups.get(title.cedentName) ?? {
      detail: "Cedente",
      label: title.cedentName,
      value: 0,
    };

    current.value += sign * title.pddValue;
    groups.set(title.cedentName, current);
  });

  return sortPddItems(Array.from(groups.values()));
}

function groupTitlesByDebtor(titles: ForecastStockTitle[]) {
  const groups = new Map<string, PddCompositionItem>();

  titles.forEach((title) => {
    const key = pddDebtorKey(title);
    const current = groups.get(key) ?? {
      detail: "Sacado",
      label: title.debtorName,
      value: 0,
    };

    current.value += title.pddValue;
    groups.set(key, current);
  });

  return sortPddItems(Array.from(groups.values()));
}

function buildProjectedPddComposition(
  stockData: ForecastStockData,
  basePdd: number,
  projectedPdd: number
) {
  if (!stockData) {
    return [
      {
        detail: "Saldo",
        label: "PDD da DRE",
        value: projectedPdd,
      },
    ];
  }

  const sign: 1 | -1 = projectedPdd < 0 || basePdd < 0 ? -1 : 1;
  const stockItems = groupTitlesByCedent(stockData.titles, sign);
  const items = [...stockItems];
  const stockTotal = sumPddItems(stockItems);
  const baseDifference = basePdd - stockTotal;
  const projectedAdjustment = projectedPdd - basePdd;

  if (Math.abs(baseDifference) >= 0.005) {
    items.push({
      detail: "Conciliação",
      label: "Diferença DRE/estoque",
      value: baseDifference,
    });
  }

  if (Math.abs(projectedAdjustment) >= 0.005) {
    items.push({
      detail: "Simulação",
      label: "Ajustes/reversões projetados",
      value: projectedAdjustment,
    });
  }

  return sortPddItems(items);
}

function PddCompositionTooltip({
  align = "right",
  caption,
  className = "",
  items,
  value,
}: {
  align?: "left" | "right";
  caption?: string;
  className?: string;
  items: PddCompositionItem[];
  value: number;
}) {
  const visibleItems = sortPddItems(items).slice(0, 8);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  const tooltipAlignment = align === "left" ? "left-0" : "right-0";

  return (
    <span
      className={`group relative inline-flex cursor-help items-center justify-end ${className}`}
      tabIndex={0}
    >
      <span className="decoration-slate-400 decoration-dotted underline-offset-4 group-hover:underline group-focus:underline">
        {currencyFormatter.format(value)}
      </span>
      <span
        className={`pointer-events-none absolute top-full z-40 mt-2 hidden w-80 rounded border border-slate-200 bg-white p-3 text-left text-xs normal-case text-slate-600 shadow-lg group-hover:block group-focus:block ${tooltipAlignment}`}
      >
        <span className="block font-semibold text-slate-950">
          Composição da PDD
        </span>
        {caption ? (
          <span className="mt-1 block text-slate-500">{caption}</span>
        ) : null}
        <span className="mt-3 block space-y-2">
          {visibleItems.length > 0 ? (
            visibleItems.map((item) => (
              <span
                className="flex items-start justify-between gap-3"
                key={`${item.label}-${item.detail ?? ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-700">
                    {item.label}
                  </span>
                  {item.detail ? (
                    <span className="block text-[11px] text-slate-400">
                      {item.detail}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-semibold text-slate-950">
                  {currencyFormatter.format(item.value)}
                </span>
              </span>
            ))
          ) : (
            <span className="block text-slate-500">Sem composição disponível.</span>
          )}
        </span>
        {hiddenCount > 0 ? (
          <span className="mt-2 block text-[11px] text-slate-400">
            +{hiddenCount} componente(s) menor(es)
          </span>
        ) : null}
        <span className="mt-3 flex justify-between border-t border-slate-100 pt-2 font-semibold text-slate-950">
          <span>Total</span>
          <span>{currencyFormatter.format(value)}</span>
        </span>
      </span>
    </span>
  );
}

function monthlyCalculationRows(rows: HistoricalRow[]) {
  const lastRow = rows.at(-1);

  if (!lastRow) {
    return [];
  }

  const lastDate = parseDateKey(lastRow.date);
  const monthRows = rows.filter((row) => {
    const date = parseDateKey(row.date);

    return (
      date.getUTCFullYear() === lastDate.getUTCFullYear() &&
      date.getUTCMonth() === lastDate.getUTCMonth()
    );
  });

  return monthRows.slice(1, -1);
}

function calculateAverageCreditRightsRevenue(rows: HistoricalRow[]) {
  const calculationRows = monthlyCalculationRows(rows);

  if (calculationRows.length === 0) {
    return 0;
  }

  const revenueTotal = calculationRows.reduce((total, row) => {
    return row.creditRightsVariation > 0
      ? total + row.creditRightsVariation
      : total;
  }, 0);

  return revenueTotal / calculationRows.length;
}

function calculateAverageFundCost(rows: HistoricalRow[]) {
  const calculationRows = monthlyCalculationRows(rows);

  if (calculationRows.length === 0) {
    return 0;
  }

  const costTotal = calculationRows.reduce(
    (total, row) => total + row.costVariation,
    0
  );

  return costTotal / calculationRows.length;
}

type StockReductionPanelProps = {
  stockData: ForecastStockData;
  futureDates: string[];
  onApplyReduction: (date: string, reversalValue: number) => void;
};

type AppliedTitleReduction = {
  debtorKey: string;
  cedentName: string;
  batchId: string;
};

type AppliedReductionBatch = {
  id: string;
  reductionDate: string;
  titleIds: string[];
};

type ComputedAppliedReductionBatch = AppliedReductionBatch & {
  cedentNames: string[];
  debtorNames: string[];
  nominalValue: number;
  pddItems: PddCompositionItem[];
  reversalValue: number;
  titleCount: number;
};

function calculateAppliedReductionState(
  stockData: ForecastStockData,
  batches: AppliedReductionBatch[]
) {
  const appliedTitleIds = new Set<string>();
  const titleReductions = new Map<string, AppliedTitleReduction>();
  const computedBatches: ComputedAppliedReductionBatch[] = [];

  if (!stockData) {
    return {
      appliedTitleIds,
      computedBatches,
      titleReductions,
    };
  }

  for (const batch of batches) {
    const batchTitleIds = new Set(batch.titleIds);
    const titles = stockData.titles.filter(
      (title) => batchTitleIds.has(title.id) && !appliedTitleIds.has(title.id)
    );
    const affectedDebtorKeys = new Set(titles.map(pddDebtorKey));
    const reversalByCedent = new Map<string, PddCompositionItem>();
    let currentPdd = 0;
    let newPdd = 0;

    affectedDebtorKeys.forEach((key) => {
      const debtorTitles = stockData.titles.filter(
        (title) => pddDebtorKey(title) === key
      );
      const previousPdd = calculateDebtorPddAfterReduction(
        stockData.latestDate,
        debtorTitles,
        appliedTitleIds
      );
      const nextAppliedTitleIds = new Set(appliedTitleIds);

      titles
        .filter((title) => pddDebtorKey(title) === key)
        .forEach((title) => nextAppliedTitleIds.add(title.id));

      const nextPdd = calculateDebtorPddAfterReduction(
        stockData.latestDate,
        debtorTitles,
        nextAppliedTitleIds
      );
      const debtorReversal = Math.max(0, previousPdd - nextPdd);
      const selectedDebtorTitles = titles.filter(
        (title) => pddDebtorKey(title) === key
      );
      const selectedNominal = selectedDebtorTitles.reduce(
        (total, title) => total + title.nominalValue,
        0
      );

      selectedDebtorTitles.forEach((title) => {
        const current = reversalByCedent.get(title.cedentName) ?? {
          detail: "Cedente",
          label: title.cedentName,
          value: 0,
        };
        const weight =
          selectedNominal > 0
            ? title.nominalValue / selectedNominal
            : 1 / selectedDebtorTitles.length;

        current.value += debtorReversal * weight;
        reversalByCedent.set(title.cedentName, current);
      });

      currentPdd += previousPdd;
      newPdd += nextPdd;
    });

    const cedentNames = Array.from(
      new Set(titles.map((title) => title.cedentName))
    ).sort((left, right) => left.localeCompare(right, "pt-BR"));
    const debtorNames = Array.from(
      new Set(titles.map((title) => title.debtorName))
    ).sort((left, right) => left.localeCompare(right, "pt-BR"));

    computedBatches.push({
      ...batch,
      cedentNames,
      debtorNames,
      nominalValue: titles.reduce((total, title) => total + title.nominalValue, 0),
      pddItems: sortPddItems(Array.from(reversalByCedent.values())),
      reversalValue: Math.max(0, currentPdd - newPdd),
      titleCount: titles.length,
    });

    titles.forEach((title) => {
      appliedTitleIds.add(title.id);
      titleReductions.set(title.id, {
        batchId: batch.id,
        cedentName: title.cedentName,
        debtorKey: pddDebtorKey(title),
      });
    });
  }

  return {
    appliedTitleIds,
    computedBatches,
    titleReductions,
  };
}

function sumReversalByDate(batches: ComputedAppliedReductionBatch[]) {
  const result = new Map<string, number>();

  batches.forEach((batch) => {
    result.set(
      batch.reductionDate,
      (result.get(batch.reductionDate) ?? 0) + batch.reversalValue
    );
  });

  return result;
}

function StockReductionPanel({
  futureDates,
  onApplyReduction,
  stockData,
}: StockReductionPanelProps) {
  const defaultDate = futureDates[0] ?? "";
  const [selectedCedent, setSelectedCedent] = useState("");
  const [selectedDebtorKey, setSelectedDebtorKey] = useState("");
  const [cedentSearch, setCedentSearch] = useState("");
  const [debtorSearch, setDebtorSearch] = useState("");
  const [isCedentMenuOpen, setIsCedentMenuOpen] = useState(false);
  const [isDebtorMenuOpen, setIsDebtorMenuOpen] = useState(false);
  const [reductionDate, setReductionDate] = useState(defaultDate);
  const [selectedTitleIds, setSelectedTitleIds] = useState<Set<string>>(
    () => new Set()
  );
  const [appliedReductionBatches, setAppliedReductionBatches] = useState<
    AppliedReductionBatch[]
  >([]);

  useEffect(() => {
    if (!stockData) {
      return;
    }

    if (
      selectedCedent &&
      !stockData.cedents.some((cedent) => cedent.name === selectedCedent)
    ) {
      setSelectedCedent("");
      setCedentSearch("");
      setSelectedDebtorKey("");
      setDebtorSearch("");
      setSelectedTitleIds(new Set());
    }
  }, [selectedCedent, stockData]);

  useEffect(() => {
    if (!futureDates.includes(reductionDate)) {
      setReductionDate(futureDates[0] ?? "");
    }
  }, [futureDates, reductionDate]);

  const filteredCedents = useMemo(() => {
    if (!stockData) {
      return [];
    }

    const normalizedSearch = normalizeSearchText(cedentSearch);

    if (!normalizedSearch) {
      return stockData.cedents;
    }

    return stockData.cedents.filter((cedent) => {
      const text = normalizeSearchText(`${cedent.name} ${cedent.document ?? ""}`);

      return text.includes(normalizedSearch);
    });
  }, [cedentSearch, stockData]);
  const cedentTitles = useMemo(() => {
    if (!stockData) {
      return [];
    }

    if (!selectedCedent && !selectedDebtorKey) {
      return [];
    }

    const titles = selectedCedent
      ? stockData.titles.filter((title) => title.cedentName === selectedCedent)
      : stockData.titles;

    if (!selectedDebtorKey) {
      return titles;
    }

    return titles.filter((title) => pddDebtorKey(title) === selectedDebtorKey);
  }, [selectedCedent, selectedDebtorKey, stockData]);
  const debtorOptions = useMemo(() => {
    if (!stockData) {
      return [];
    }

    const normalizedSearch = normalizeSearchText(debtorSearch);
    const titles = selectedCedent
      ? stockData.titles.filter((title) => title.cedentName === selectedCedent)
      : stockData.titles;
    const debtors = new Map<
      string,
      {
        key: string;
        name: string;
        document: string | null;
        titleCount: number;
        nominalValue: number;
        pddValue: number;
      }
    >();

    for (const title of titles) {
      const key = pddDebtorKey(title);
      const current = debtors.get(key) ?? {
        key,
        name: title.debtorName,
        document: title.debtorDocument,
        titleCount: 0,
        nominalValue: 0,
        pddValue: 0,
      };
      current.titleCount += 1;
      current.nominalValue += title.nominalValue;
      current.pddValue += title.pddValue;
      debtors.set(key, current);
    }

    const values = Array.from(debtors.values()).sort((left, right) =>
      left.name.localeCompare(right.name, "pt-BR")
    );

    if (!normalizedSearch) {
      return values;
    }

    return values.filter((debtor) => {
      const text = normalizeSearchText(
        `${debtor.name} ${debtor.document ?? ""} ${debtor.key}`
      );

      return text.includes(normalizedSearch);
    });
  }, [debtorSearch, selectedCedent, stockData]);
  const appliedReductionState = useMemo(
    () => calculateAppliedReductionState(stockData, appliedReductionBatches),
    [appliedReductionBatches, stockData]
  );
  const appliedTitleReductions = appliedReductionState.titleReductions;
  const appliedTitleIds = appliedReductionState.appliedTitleIds;
  const computedAppliedReductionBatches =
    appliedReductionState.computedBatches;
  const appliedReversalByDate = useMemo(
    () => sumReversalByDate(computedAppliedReductionBatches),
    [computedAppliedReductionBatches]
  );
  const selectedTitles = useMemo(
    () =>
      cedentTitles.filter(
        (title) =>
          selectedTitleIds.has(title.id) && !appliedTitleReductions.has(title.id)
      ),
    [appliedTitleReductions, cedentTitles, selectedTitleIds]
  );
  const selectedNominalValue = selectedTitles.reduce(
    (total, title) => total + title.nominalValue,
    0
  );
  const appliedDebtorSourceByKey = useMemo(() => {
    const result = new Map<string, string>();

    appliedTitleReductions.forEach((reduction) => {
      if (!result.has(reduction.debtorKey)) {
        result.set(reduction.debtorKey, reduction.cedentName);
      }
    });

    return result;
  }, [appliedTitleReductions]);
  const rowPddImpactByTitleId = useMemo(() => {
    const result = new Map<string, number>();

    if (!stockData) {
      return result;
    }

    for (const title of cedentTitles) {
      if (appliedTitleReductions.has(title.id)) {
        result.set(title.id, 0);
        continue;
      }

      const key = pddDebtorKey(title);
      const debtorTitles = stockData.titles.filter(
        (item) => pddDebtorKey(item) === key
      );
      const previousPdd = calculateDebtorPddAfterReduction(
        stockData.latestDate,
        debtorTitles,
        appliedTitleIds
      );
      const nextAppliedTitleIds = new Set(appliedTitleIds);
      nextAppliedTitleIds.add(title.id);
      const nextPdd = calculateDebtorPddAfterReduction(
        stockData.latestDate,
        debtorTitles,
        nextAppliedTitleIds
      );

      result.set(title.id, Math.max(0, previousPdd - nextPdd));
    }

    return result;
  }, [appliedTitleIds, appliedTitleReductions, cedentTitles, stockData]);
  const reductionSimulation = useMemo(() => {
    if (!stockData) {
      return {
        currentPdd: 0,
        newPdd: 0,
        pddItems: [],
        reversalValue: 0,
        affectedDebtors: 0,
      };
    }

    const affectedDebtorKeys = new Set(selectedTitles.map(pddDebtorKey));
    const reversalByCedent = new Map<string, PddCompositionItem>();
    let currentPdd = 0;
    let newPdd = 0;

    affectedDebtorKeys.forEach((key) => {
      const debtorTitles = stockData.titles.filter(
        (title) => pddDebtorKey(title) === key
      );
      const previousPdd = calculateDebtorPddAfterReduction(
        stockData.latestDate,
        debtorTitles,
        appliedTitleIds
      );
      const nextAppliedTitleIds = new Set(appliedTitleIds);

      selectedTitles
        .filter((title) => pddDebtorKey(title) === key)
        .forEach((title) => nextAppliedTitleIds.add(title.id));

      const nextPdd = calculateDebtorPddAfterReduction(
        stockData.latestDate,
        debtorTitles,
        nextAppliedTitleIds
      );
      const debtorReversal = Math.max(0, previousPdd - nextPdd);
      const selectedDebtorTitles = selectedTitles.filter(
        (title) => pddDebtorKey(title) === key
      );
      const selectedNominal = selectedDebtorTitles.reduce(
        (total, title) => total + title.nominalValue,
        0
      );

      selectedDebtorTitles.forEach((title) => {
        const current = reversalByCedent.get(title.cedentName) ?? {
          detail: "Cedente",
          label: title.cedentName,
          value: 0,
        };
        const weight =
          selectedNominal > 0
            ? title.nominalValue / selectedNominal
            : 1 / selectedDebtorTitles.length;

        current.value += debtorReversal * weight;
        reversalByCedent.set(title.cedentName, current);
      });

      currentPdd += previousPdd;
      newPdd += nextPdd;
    });

    return {
      currentPdd,
      newPdd,
      pddItems: sortPddItems(Array.from(reversalByCedent.values())),
      reversalValue: Math.max(0, currentPdd - newPdd),
      affectedDebtors: affectedDebtorKeys.size,
    };
  }, [appliedTitleIds, selectedTitles, stockData]);

  function toggleTitle(titleId: string) {
    const title = cedentTitles.find((item) => item.id === titleId);

    if (!title || appliedTitleReductions.has(title.id)) {
      return;
    }

    setSelectedTitleIds((current) => {
      const next = new Set(current);

      if (next.has(titleId)) {
        next.delete(titleId);
      } else {
        next.add(titleId);
      }

      return next;
    });
  }

  function selectAllVisibleTitles() {
    setSelectedTitleIds(
      new Set(
        cedentTitles
          .filter((title) => !appliedTitleReductions.has(title.id))
          .map((title) => title.id)
      )
    );
  }

  function clearSelectedTitles() {
    setSelectedTitleIds(new Set());
  }

  function handleApply() {
    if (!reductionDate || selectedTitles.length === 0) {
      return;
    }

    if (reductionSimulation.reversalValue > 0) {
      onApplyReduction(reductionDate, reductionSimulation.reversalValue);
    }
    setAppliedReductionBatches((current) => [
      ...current,
      {
        id: `${Date.now()}-${selectedTitles.map((title) => title.id).join("-")}`,
        reductionDate,
        titleIds: selectedTitles.map((title) => title.id),
      },
    ]);
    setSelectedTitleIds(new Set());
  }

  function removeAppliedReduction(batchId: string) {
    if (!stockData) {
      return;
    }

    const previousTotals = appliedReversalByDate;
    const nextBatches = appliedReductionBatches.filter(
      (batch) => batch.id !== batchId
    );
    const nextComputedBatches = calculateAppliedReductionState(
      stockData,
      nextBatches
    ).computedBatches;
    const nextTotals = sumReversalByDate(nextComputedBatches);
    const affectedDates = new Set([
      ...Array.from(previousTotals.keys()),
      ...Array.from(nextTotals.keys()),
    ]);

    affectedDates.forEach((date) => {
      const delta = (nextTotals.get(date) ?? 0) - (previousTotals.get(date) ?? 0);

      if (Math.abs(delta) >= 0.005) {
        onApplyReduction(date, delta);
      }
    });

    setAppliedReductionBatches(nextBatches);
    setSelectedTitleIds(new Set());
  }

  if (!stockData) {
    return (
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <h2 className="text-base font-semibold text-slate-950">
          Baixa de títulos do estoque
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Nenhum estoque encontrado para o fundo selecionado.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded border border-slate-200 bg-white shadow-executive">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Baixa de títulos do estoque
            </h2>
            <p className="text-sm text-slate-500">
              Estoque {stockData.fundName} em {formatDate(stockData.latestDate)}
            </p>
          </div>
          <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3 lg:min-w-[520px]">
            <div className="rounded border border-slate-200 px-3 py-2">
              <p className="text-xs uppercase text-slate-500">Títulos</p>
              <p className="font-semibold text-slate-950">{selectedTitles.length}</p>
            </div>
            <div className="rounded border border-slate-200 px-3 py-2">
              <p className="text-xs uppercase text-slate-500">Valor nominal</p>
              <p className="font-semibold text-slate-950">
                {currencyFormatter.format(selectedNominalValue)}
              </p>
            </div>
            <div className="rounded border border-slate-200 px-3 py-2">
              <p className="text-xs uppercase text-slate-500">Reversão PDD</p>
              <p className="font-semibold text-emerald-700">
                <PddCompositionTooltip
                  caption="Cedentes que formam a reversao estimada da selecao atual."
                  items={reductionSimulation.pddItems}
                  value={reductionSimulation.reversalValue}
                />
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_minmax(260px,1fr)_180px_auto_auto] lg:items-start">
          <div className="relative space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="cedentSearch">
              Buscar cedente
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              id="cedentSearch"
              onBlur={() => setTimeout(() => setIsCedentMenuOpen(false), 120)}
              onChange={(event) => {
                setCedentSearch(event.target.value);
                setSelectedCedent("");
                setSelectedDebtorKey("");
                setDebtorSearch("");
                setIsCedentMenuOpen(true);
                setSelectedTitleIds(new Set());
              }}
              onFocus={() => setIsCedentMenuOpen(true)}
              placeholder="Digite nome ou CNPJ"
              type="search"
              value={cedentSearch}
            />
            {isCedentMenuOpen && filteredCedents.length === 0 ? (
              <p className="text-xs font-medium text-destructive">
                Nenhum cedente encontrado.
              </p>
            ) : null}
            <div
              className={
                isCedentMenuOpen
                  ? "absolute z-20 max-h-72 w-full overflow-y-auto rounded border border-slate-200 bg-white shadow-lg"
                  : "hidden"
              }
            >
              {filteredCedents.slice(0, 40).map((cedent) => {
                const isSelected = cedent.name === selectedCedent;

                return (
                  <button
                    className={
                      isSelected
                        ? "block w-full border-b border-slate-100 bg-emerald-50 px-3 py-2 text-left text-sm text-emerald-800 last:border-0"
                        : "block w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 last:border-0"
                    }
                    key={cedent.name}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setSelectedCedent(cedent.name);
                      setCedentSearch(cedent.name);
                      setSelectedDebtorKey("");
                      setDebtorSearch("");
                      setSelectedTitleIds(new Set());
                      setIsCedentMenuOpen(false);
                    }}
                    type="button"
                  >
                    <span className="block font-semibold">{cedent.name}</span>
                    <span className="text-xs text-slate-500">
                      {cedent.titleCount} titulos · PDD{" "}
                      <PddCompositionTooltip
                        align="left"
                        caption="Sacados que formam a PDD deste cedente."
                        items={groupTitlesByDebtor(
                          stockData.titles.filter(
                            (title) => title.cedentName === cedent.name
                          )
                        )}
                        value={cedent.pddValue}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
            {isCedentMenuOpen && filteredCedents.length > 40 ? (
              <p className="text-xs text-slate-500">
                Mostrando 40 cedentes. Refine a busca para encontrar outros.
              </p>
            ) : null}
          </div>

          <div className="relative space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="debtorSearch">
              Buscar sacado
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              id="debtorSearch"
              onBlur={() => setTimeout(() => setIsDebtorMenuOpen(false), 120)}
              onChange={(event) => {
                setDebtorSearch(event.target.value);
                setSelectedDebtorKey("");
                setIsDebtorMenuOpen(true);
                setSelectedTitleIds(new Set());
              }}
              onFocus={() => setIsDebtorMenuOpen(true)}
              placeholder="Digite sacado, CNPJ ou documento"
              type="search"
              value={debtorSearch}
            />
            {isDebtorMenuOpen ? (
              <div className="absolute z-20 max-h-72 w-full overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
                {debtorOptions.length > 0 ? (
                  debtorOptions.slice(0, 40).map((debtor) => (
                    <button
                      className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 last:border-0"
                      key={debtor.key}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setSelectedDebtorKey(debtor.key);
                        setDebtorSearch(debtor.name);
                        setSelectedTitleIds(new Set());
                        setIsDebtorMenuOpen(false);
                      }}
                      type="button"
                    >
                      <span className="block font-semibold">{debtor.name}</span>
                      <span className="text-xs text-slate-500">
                        {debtor.titleCount} titulos · PDD{" "}
                        <PddCompositionTooltip
                          align="left"
                          caption="Cedentes que formam a PDD deste sacado no filtro atual."
                          items={groupTitlesByCedent(
                            stockData.titles.filter(
                              (title) =>
                                pddDebtorKey(title) === debtor.key &&
                                (!selectedCedent ||
                                  title.cedentName === selectedCedent)
                            )
                          )}
                          value={debtor.pddValue}
                        />
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-3 text-sm text-slate-500">
                    Nenhum sacado encontrado.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <div className="space-y-2 lg:self-end">
            <label className="text-sm font-medium text-slate-700" htmlFor="reductionDate">
              Data da baixa
            </label>
            <select
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              disabled={futureDates.length === 0}
              id="reductionDate"
              onChange={(event) => setReductionDate(event.target.value)}
              value={reductionDate}
            >
              {futureDates.map((date) => (
                <option key={date} value={date}>
                  {formatDate(date)}
                </option>
              ))}
            </select>
          </div>

          <button
            className="h-10 rounded border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 lg:self-end"
            onClick={selectAllVisibleTitles}
            type="button"
          >
            Selecionar todos
          </button>

          <button
            onClick={clearSelectedTitles}
            type="button"
            className="h-10 rounded border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 lg:self-end"
          >
            Limpar
          </button>
        </div>

        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <th className="w-12 px-4 py-3 text-left font-semibold"></th>
                <th className="px-4 py-3 text-left font-semibold">Vencimento</th>
                <th className="px-4 py-3 text-left font-semibold">Documento</th>
                <th className="px-4 py-3 text-left font-semibold">Sacado</th>
                <th className="px-4 py-3 text-right font-semibold">Valor nominal</th>
                <th className="px-4 py-3 text-right font-semibold">PDD</th>
                <th className="px-4 py-3 text-left font-semibold">Faixa</th>
                <th className="px-4 py-3 text-left font-semibold">Situação</th>
              </tr>
            </thead>
            <tbody>
              {cedentTitles.length > 0 ? (
                cedentTitles.map((title) => {
                  const appliedTitleReduction = appliedTitleReductions.get(title.id);
                  const debtorKey = pddDebtorKey(title);
                  const appliedDebtorSource = appliedDebtorSourceByKey.get(debtorKey);
                  const rowPddImpact = rowPddImpactByTitleId.get(title.id) ?? 0;
                  const hasNoPddImpact =
                    !appliedTitleReduction &&
                    Boolean(appliedDebtorSource) &&
                    rowPddImpact <= 0;

                  return (
                  <tr
                    className={
                      appliedTitleReduction || hasNoPddImpact
                        ? "border-b border-slate-100 bg-slate-50 last:border-0"
                        : "border-b border-slate-100 last:border-0"
                    }
                    key={title.id}
                  >
                    <td className="px-4 py-3">
                      <input
                        checked={
                          selectedTitleIds.has(title.id) && !appliedTitleReduction
                        }
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={Boolean(appliedTitleReduction)}
                        onChange={() => toggleTitle(title.id)}
                        type="checkbox"
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDate(title.originalDueDate)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {title.documentNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <span className="block">{title.debtorName}</span>
                      {appliedTitleReduction ? (
                        <span className="mt-1 block text-xs font-semibold text-amber-700">
                          título já baixado no {appliedTitleReduction.cedentName}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-950">
                      {currencyFormatter.format(title.nominalValue)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {hasNoPddImpact ? (
                        <span className="line-through decoration-2">
                          <PddCompositionTooltip
                            caption="PDD individual do titulo selecionado."
                            items={[
                              {
                                detail: title.debtorName,
                                label: title.cedentName,
                                value: title.pddValue,
                              },
                            ]}
                            value={title.pddValue}
                          />
                        </span>
                      ) : (
                        <PddCompositionTooltip
                          caption="PDD individual do titulo selecionado."
                          items={[
                            {
                              detail: title.debtorName,
                              label: title.cedentName,
                              value: title.pddValue,
                            },
                          ]}
                          value={title.pddValue}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {title.pddRange ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <span className="block">{title.situation ?? "-"}</span>
                      {hasNoPddImpact && appliedDebtorSource ? (
                        <span className="mt-1 block text-xs font-semibold text-amber-700">
                          sem interferência na PDD pois já foi resolvido pela baixa do{" "}
                          {appliedDebtorSource}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={8}>
                    Nenhum título encontrado para este cedente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            Valor que será lançado em Variação PDD:{" "}
            <span className="font-semibold text-emerald-700">
              {formatSignedCurrency(-reductionSimulation.reversalValue)}
            </span>
            <span className="ml-2 text-xs text-slate-400">
              PDD atual {currencyFormatter.format(reductionSimulation.currentPdd)}
              {" -> "}
              nova PDD {currencyFormatter.format(reductionSimulation.newPdd)}
              {" · "}
              {reductionSimulation.affectedDebtors} sacado(s)
            </span>
          </p>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!reductionDate || selectedTitles.length === 0}
            onClick={handleApply}
            type="button"
          >
            <Calculator className="h-4 w-4" />
            Aplicar reversão
          </button>
        </div>
        <div className="border-t border-slate-200 pt-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">
                Baixas aplicadas nesta simulacao
              </h3>
              <p className="text-xs text-slate-500">
                Remova uma baixa para recalcular automaticamente as reversoes de PDD.
              </p>
            </div>
            <p className="text-sm font-semibold text-emerald-700">
              Total PDD{" "}
              <PddCompositionTooltip
                caption="Cedentes que formam todas as reversoes aplicadas nesta simulacao."
                items={mergePddItems(
                  computedAppliedReductionBatches.flatMap(
                    (batch) => batch.pddItems
                  )
                )}
                value={computedAppliedReductionBatches.reduce(
                  (total, batch) => total + batch.reversalValue,
                  0
                )}
              />
            </p>
          </div>

          {computedAppliedReductionBatches.length > 0 ? (
            <div className="mt-3 overflow-x-auto rounded border border-slate-200">
              <table className="min-w-[980px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <th className="px-4 py-3 text-left font-semibold">Data</th>
                    <th className="px-4 py-3 text-left font-semibold">Cedente</th>
                    <th className="px-4 py-3 text-left font-semibold">Sacado</th>
                    <th className="px-4 py-3 text-right font-semibold">Titulos</th>
                    <th className="px-4 py-3 text-right font-semibold">Valor nominal</th>
                    <th className="px-4 py-3 text-right font-semibold">Reversao PDD</th>
                    <th className="px-4 py-3 text-right font-semibold">Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {computedAppliedReductionBatches.map((batch) => (
                    <tr className="border-b border-slate-100 last:border-0" key={batch.id}>
                      <td className="px-4 py-3 text-slate-700">
                        {formatDate(batch.reductionDate)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {batch.cedentNames.join(", ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {batch.debtorNames.join(", ") || "-"}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {batch.titleCount}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {currencyFormatter.format(batch.nominalValue)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                        <PddCompositionTooltip
                          caption="Cedentes que compõem esta reversao aplicada."
                          items={batch.pddItems}
                          value={batch.reversalValue}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className="inline-flex h-9 items-center justify-center gap-2 rounded border border-red-200 px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50"
                          onClick={() => removeAppliedReduction(batch.id)}
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                          Tirar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 rounded border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
              Nenhuma baixa aplicada nesta simulacao.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export function QuotaForecastPlanner({
  funds,
  selectedFundId,
  historicalRows,
  baseShareQuantity,
  stockData,
}: QuotaForecastPlannerProps) {
  const lastHistorical = historicalRows.at(-1) ?? null;
  const defaultViewDate = lastHistorical
    ? dateKey(addDays(parseDateKey(lastHistorical.date), 10))
    : dateKey(new Date());
  const [viewDate, setViewDate] = useState(defaultViewDate);
  const [shareQuantity, setShareQuantity] = useState(baseShareQuantity);
  const [inputs, setInputs] = useState<Record<string, ForecastInput>>({});
  const averageCreditRightsRevenue = useMemo(
    () => calculateAverageCreditRightsRevenue(historicalRows),
    [historicalRows]
  );
  const averageFundCost = useMemo(
    () => calculateAverageFundCost(historicalRows),
    [historicalRows]
  );
  const lastPatrimonio = lastHistorical?.patrimonio ?? 0;
  const lastCreditRights = lastHistorical?.creditRights ?? 0;
  const lastPdd = lastHistorical?.pdd ?? 0;
  const lastMonthlyReturn = lastHistorical?.variacaoMensal ?? 0;
  const lastYearlyReturn = lastHistorical?.variacaoAnual ?? 0;

  const futureDates = useMemo(
    () => buildFutureDates(lastHistorical?.date ?? null, viewDate),
    [lastHistorical?.date, viewDate]
  );

  const projections = useMemo(() => {
    let previousPl = lastPatrimonio;
    let previousCreditRights = lastCreditRights;
    let previousPdd = lastPdd;
    const quantity = shareQuantity > 0 ? shareQuantity : 0;
    let previousReturnBase =
      quantity > 0 ? lastPatrimonio / quantity : lastPatrimonio;
    const baseReturnValue = previousReturnBase;
    const baseMonthReturn = lastMonthlyReturn / 100;
    const baseYearReturn = lastYearlyReturn / 100;

    return futureDates.map((date) => {
      const input = inputs[date] ?? { pddDelta: 0 };
      previousCreditRights += averageCreditRightsRevenue;
      previousPdd -= input.pddDelta;
      previousPl =
        previousPl + averageCreditRightsRevenue - averageFundCost - input.pddDelta;
      const quotaValue = quantity > 0 ? previousPl / quantity : 0;
      const returnBase = quantity > 0 ? quotaValue : previousPl;
      const dailyReturn =
        previousReturnBase > 0 ? ((returnBase / previousReturnBase) - 1) * 100 : 0;
      const returnFromBase =
        baseReturnValue > 0 ? (returnBase / baseReturnValue) - 1 : 0;
      const monthlyReturn =
        ((1 + baseMonthReturn) * (1 + returnFromBase) - 1) * 100;
      const yearlyReturn =
        ((1 + baseYearReturn) * (1 + returnFromBase) - 1) * 100;
      previousReturnBase = returnBase;

      return {
        date,
        creditRights: previousCreditRights,
        creditRightsRevenue: averageCreditRightsRevenue,
        fundCost: averageFundCost,
        pdd: previousPdd,
        patrimonio: previousPl,
        quotaValue,
        dailyReturn,
        monthlyReturn,
        yearlyReturn,
        pddDelta: input.pddDelta,
      };
    });
  }, [
    averageCreditRightsRevenue,
    averageFundCost,
    futureDates,
    inputs,
    lastCreditRights,
    lastMonthlyReturn,
    lastPatrimonio,
    lastPdd,
    lastYearlyReturn,
    shareQuantity,
  ]);

  const finalProjection = projections.at(-1);
  const baseQuota =
    shareQuantity > 0 && lastHistorical ? lastHistorical.patrimonio / shareQuantity : 0;
  const projectedQuota = finalProjection?.quotaValue ?? baseQuota;

  function updatePddInput(date: string, value: string) {
    setInputs((current) => ({
      ...current,
      [date]: {
        pddDelta: toInputNumber(value),
      },
    }));
  }

  function applyStockReduction(date: string, reversalValue: number) {
    setInputs((current) => {
      const currentValue = current[date]?.pddDelta ?? 0;

      return {
        ...current,
        [date]: {
          pddDelta: currentValue - reversalValue,
        },
      };
    });
  }

  const projectedDailyReturn = finalProjection?.dailyReturn ?? 0;
  const projectedMonthlyReturn =
    finalProjection?.monthlyReturn ?? lastMonthlyReturn;
  const projectedYearlyReturn =
    finalProjection?.yearlyReturn ?? lastYearlyReturn;

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <form className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_180px_220px_auto] md:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="fundId">
              Fundo
            </label>
            <select
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              defaultValue={selectedFundId}
              id="fundId"
              name="fundId"
            >
              {funds.map((fund) => (
                <option key={fund.id} value={fund.id}>
                  {fund.shortName || fund.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="viewDate">
              Data de Visualização
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              id="viewDate"
              min={lastHistorical?.date}
              onChange={(event) => setViewDate(event.target.value)}
              type="date"
              value={viewDate}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="shareQuantity">
              Quantidade de cotas
            </label>
            <input
              className="h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              id="shareQuantity"
              onChange={(event) => setShareQuantity(toInputNumber(event.target.value))}
              step="0.000001"
              type="number"
              value={shareQuantity || ""}
            />
          </div>

          <button
            className="h-10 rounded bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            type="submit"
          >
            Aplicar
          </button>
        </form>
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            DRE histórica
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Última base real: {lastHistorical ? formatDate(lastHistorical.date) : "-"}
          </p>
        </div>

        {historicalRows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500">
            Nenhum dado histórico encontrado para o fundo selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-4 py-3 text-left font-semibold">Data</th>
                  <th className="px-4 py-3 text-right font-semibold">Patrimônio</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Direitos Creditórios
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Variação real DC
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">PDD</th>
                  <th className="px-4 py-3 text-right font-semibold">Rent. mensal</th>
                  <th className="px-4 py-3 text-right font-semibold">Cota</th>
                </tr>
              </thead>
              <tbody>
                {historicalRows.map((row) => (
                  <tr className="border-b border-slate-100 last:border-0" key={row.date}>
                    <td className="px-4 py-3 text-slate-700">{formatDate(row.date)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-950">
                      {currencyFormatter.format(row.patrimonio)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {currencyFormatter.format(row.creditRights)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatSignedCurrency(row.creditRightsVariation)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      <PddCompositionTooltip
                        caption="Composicao pelo ultimo estoque disponivel; eventuais diferencas aparecem em conciliacao."
                        items={buildProjectedPddComposition(
                          stockData,
                          row.pdd,
                          row.pdd
                        )}
                        value={row.pdd}
                      />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {percentFormatter.format(row.variacaoMensal)}%
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {decimalFormatter.format(
                        shareQuantity > 0 ? row.patrimonio / shareQuantity : 0
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            Previsão diária
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {futureDates.length} datas futuras até {viewDate ? formatDate(viewDate) : "-"}
          </p>
        </div>

        {futureDates.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500">
            Escolha uma data posterior à última base real.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1440px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-4 py-3 text-left font-semibold">Data</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    <span
                      className="inline-flex items-center justify-end gap-1"
                      title="Valor positivo aumenta a PDD/provisão, deixa a PDD projetada mais negativa e reduz o PL. Valor negativo representa reversão de PDD, deixa a PDD menos negativa e aumenta o PL."
                    >
                      Variação PDD
                      <Info className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    <span
                      className="inline-flex items-center justify-end gap-1"
                      title="Média aritmética dos últimos 15 valores de Direitos Creditórios da DRE/Variação: DC de hoje menos DC de ontem, menos compras e mais liquidações. Esse valor é replicado em cada data futura da projeção."
                    >
                      Receita média DC
                      <Info className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    <span
                      className="inline-flex items-center justify-end gap-1"
                      title="Media dos ultimos 15 custos positivos calculados pela DRE/Variacao: Total Superiores mais Total Despesas, ignorando despesas positivas. Esse custo e descontado do PL em cada data futura."
                    >
                      Custo medio
                      <Info className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">DC projetado</th>
                  <th className="px-4 py-3 text-right font-semibold">PDD projetada</th>
                  <th className="px-4 py-3 text-right font-semibold">PL projetado</th>
                  <th className="px-4 py-3 text-right font-semibold">Cota projetada</th>
                  <th className="px-4 py-3 text-right font-semibold">Rent. diária</th>
                  <th className="px-4 py-3 text-right font-semibold">Rent. mensal acum.</th>
                  <th className="px-4 py-3 text-right font-semibold">Rent. anual acum.</th>
                </tr>
              </thead>
              <tbody>
                {projections.map((row) => (
                  <tr className="border-b border-slate-100 last:border-0" key={row.date}>
                    <td className="px-4 py-3 font-medium text-slate-700">
                      {formatDate(row.date)}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        className="h-9 w-full rounded border border-slate-200 px-3 text-right text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                        onChange={(event) =>
                          updatePddInput(row.date, event.target.value)
                        }
                        placeholder="0,00"
                        type="text"
                        value={formatInputNumber(inputs[row.date]?.pddDelta)}
                      />
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-700">
                      {formatSignedCurrency(row.creditRightsRevenue)}
                    </td>
                    <td className="px-4 py-3 text-right text-red-700">
                      {formatSignedCurrency(-row.fundCost)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {currencyFormatter.format(row.creditRights)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      <PddCompositionTooltip
                        caption="PDD projetada por cedente, somando a base do estoque e os ajustes simulados ate esta data."
                        items={buildProjectedPddComposition(
                          stockData,
                          lastPdd,
                          row.pdd
                        )}
                        value={row.pdd}
                      />
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-950">
                      {currencyFormatter.format(row.patrimonio)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-950">
                      {decimalFormatter.format(row.quotaValue)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {percentFormatter.format(row.dailyReturn)}%
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {percentFormatter.format(row.monthlyReturn)}%
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {percentFormatter.format(row.yearlyReturn)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-950">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right">
                    {formatSignedCurrency(
                      projections.reduce((total, row) => total + row.pddDelta, 0)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatSignedCurrency(
                      projections.reduce(
                        (total, row) => total + row.creditRightsRevenue,
                        0
                      )
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatSignedCurrency(
                      -projections.reduce((total, row) => total + row.fundCost, 0)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {currencyFormatter.format(
                      finalProjection?.creditRights ??
                        lastHistorical?.creditRights ??
                        0
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PddCompositionTooltip
                      caption="Composicao final da PDD projetada por cedente."
                      items={buildProjectedPddComposition(
                        stockData,
                        lastPdd,
                        finalProjection?.pdd ?? lastHistorical?.pdd ?? 0
                      )}
                      value={finalProjection?.pdd ?? lastHistorical?.pdd ?? 0}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {currencyFormatter.format(
                      finalProjection?.patrimonio ?? lastHistorical?.patrimonio ?? 0
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {decimalFormatter.format(projectedQuota)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {percentFormatter.format(projectedDailyReturn)}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    {percentFormatter.format(projectedMonthlyReturn)}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    {percentFormatter.format(projectedYearlyReturn)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <StockReductionPanel
        futureDates={futureDates}
        onApplyReduction={applyStockReduction}
        stockData={stockData}
      />
    </div>
  );
}
