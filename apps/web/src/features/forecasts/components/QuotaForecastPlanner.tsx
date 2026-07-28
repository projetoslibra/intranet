"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Info } from "lucide-react";
import {
  calculatePddReversalSimulation,
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

function calculateAverageCreditRightsRevenue(rows: HistoricalRow[]) {
  const lastDeltas = rows
    .slice(1)
    .map((row) => row.creditRightsVariation)
    .slice(-15);

  if (lastDeltas.length === 0) {
    return 0;
  }

  return lastDeltas.reduce((total, value) => total + value, 0) / lastDeltas.length;
}

function calculateAverageFundCost(rows: HistoricalRow[]) {
  const lastCosts = rows
    .slice(1)
    .map((row) => row.costVariation)
    .filter((value) => value > 0)
    .slice(-15);

  if (lastCosts.length === 0) {
    return 0;
  }

  return lastCosts.reduce((total, value) => total + value, 0) / lastCosts.length;
}

type StockReductionPanelProps = {
  stockData: ForecastStockData;
  futureDates: string[];
  onApplyReduction: (date: string, reversalValue: number) => void;
};

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
  const selectedTitles = useMemo(
    () => cedentTitles.filter((title) => selectedTitleIds.has(title.id)),
    [cedentTitles, selectedTitleIds]
  );
  const selectedNominalValue = selectedTitles.reduce(
    (total, title) => total + title.nominalValue,
    0
  );
  const reductionSimulation = useMemo(() => {
    if (!stockData) {
      return {
        currentPdd: 0,
        newPdd: 0,
        reversalValue: 0,
        affectedDebtors: 0,
      };
    }

    return calculatePddReversalSimulation(
      stockData.latestDate,
      stockData.titles,
      selectedTitles,
      selectedTitleIds
    );
  }, [selectedTitleIds, selectedTitles, stockData]);

  function toggleTitle(titleId: string) {
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
    setSelectedTitleIds(new Set(cedentTitles.map((title) => title.id)));
  }

  function clearSelectedTitles() {
    setSelectedTitleIds(new Set());
  }

  function handleApply() {
    if (!reductionDate || reductionSimulation.reversalValue <= 0) {
      return;
    }

    onApplyReduction(reductionDate, reductionSimulation.reversalValue);
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
                {currencyFormatter.format(reductionSimulation.reversalValue)}
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
                      {currencyFormatter.format(cedent.pddValue)}
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
                        {currencyFormatter.format(debtor.pddValue)}
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
                cedentTitles.map((title) => (
                  <tr className="border-b border-slate-100 last:border-0" key={title.id}>
                    <td className="px-4 py-3">
                      <input
                        checked={selectedTitleIds.has(title.id)}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
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
                      {title.debtorName}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-950">
                      {currencyFormatter.format(title.nominalValue)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {currencyFormatter.format(title.pddValue)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {title.pddRange ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {title.situation ?? "-"}
                    </td>
                  </tr>
                ))
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
            disabled={!reductionDate || reductionSimulation.reversalValue <= 0}
            onClick={handleApply}
            type="button"
          >
            <Calculator className="h-4 w-4" />
            Aplicar reversão
          </button>
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
                      {currencyFormatter.format(row.pdd)}
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
                      {currencyFormatter.format(row.pdd)}
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
                    {currencyFormatter.format(finalProjection?.pdd ?? lastHistorical?.pdd ?? 0)}
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
