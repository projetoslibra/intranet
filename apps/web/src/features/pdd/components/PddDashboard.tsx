"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";

export type PddMatrixDate = {
  key: string;
  label: string;
  isBase: boolean;
};

export type PddDebtorMatrixRow = {
  key: string;
  name: string;
  document: string | null;
  titleCount: number;
  presentValue: number;
  currentPdd: number;
  values: Record<string, number>;
};

export type PddCedentMatrixRow = {
  key: string;
  name: string;
  document: string | null;
  titleCount: number;
  debtorCount: number;
  presentValue: number;
  currentPdd: number;
  values: Record<string, number>;
  debtors: PddDebtorMatrixRow[];
};

export type PddTurnover = {
  date: string;
  dateLabel: string;
  cedentName: string;
  debtorName: string;
  debtorDocument: string | null;
  previousRange: string;
  nextRange: string;
  value: number;
  presentValue: number;
};

export type PddSummary = {
  referenceDateLabel: string;
  fundName: string;
  titleCount: number;
  cedentCount: number;
  debtorCount: number;
  presentValue: number;
  currentPdd: number;
  projectedSevenDaysPdd: number;
  projectedFifteenDaysPdd: number;
};

type PddDashboardProps = {
  dates: PddMatrixDate[];
  rows: PddCedentMatrixRow[];
  summary: PddSummary;
  turnovers: PddTurnover[];
};

type MatrixSortMode = "alpha" | "pdd_desc";

function formatSignedCurrency(value: number) {
  if (Math.abs(value) < 0.005) {
    return formatCurrency(0);
  }

  return `${value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

function compactDocument(value: string | null) {
  return value || "-";
}

function MatrixValue({
  changed,
  previousValue,
  value,
}: {
  changed: boolean;
  previousValue: number;
  value: number;
}) {
  const className = value > 0 ? "font-semibold text-red-700" : "font-medium text-slate-500";

  return (
    <span
      className={className}
      title={
        changed
          ? `Alterou ${formatSignedCurrency(value - previousValue)} vs. dia anterior`
          : undefined
      }
    >
      {formatCurrency(value)}
    </span>
  );
}

function matrixCellClass(changed: boolean) {
  return changed
    ? "border-b border-amber-200 bg-amber-50 px-4 py-3 text-right"
    : "border-b border-slate-100 px-4 py-3 text-right";
}

function rowHasMonthlyChange(row: PddCedentMatrixRow, dates: PddMatrixDate[]) {
  const baseMonth = dates[0]?.key.slice(0, 7);

  if (!baseMonth) {
    return false;
  }

  return dates.some((date, index) => {
    if (index === 0 || !date.key.startsWith(baseMonth)) {
      return false;
    }

    const previousDate = dates[index - 1];
    const value = row.values[date.key] ?? 0;
    const previousValue = row.values[previousDate.key] ?? 0;

    return Math.abs(value - previousValue) >= 0.005;
  });
}

export function PddDashboard({
  dates,
  rows,
  summary,
  turnovers,
}: PddDashboardProps) {
  const [expandedCedents, setExpandedCedents] = useState<Set<string>>(
    () => new Set()
  );
  const [isTurnoversOpen, setIsTurnoversOpen] = useState(false);
  const [matrixSortMode, setMatrixSortMode] =
    useState<MatrixSortMode>("alpha");
  const [showOnlyMonthTurnovers, setShowOnlyMonthTurnovers] = useState(false);
  const pddDeltaSevenDays = summary.projectedSevenDaysPdd - summary.currentPdd;
  const pddDeltaFifteenDays =
    summary.projectedFifteenDaysPdd - summary.currentPdd;
  const hasAnyExpansion = expandedCedents.size > 0;

  function toggleCedent(key: string) {
    setExpandedCedents((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  function expandAll() {
    setExpandedCedents(new Set(visibleRows.map((row) => row.key)));
  }

  function collapseAll() {
    setExpandedCedents(new Set());
  }

  const sortedTurnovers = useMemo(
    () => [...turnovers].sort((left, right) => right.value - left.value),
    [turnovers]
  );
  const visibleRows = useMemo(() => {
    const filteredRows = showOnlyMonthTurnovers
      ? rows.filter((row) => rowHasMonthlyChange(row, dates))
      : rows;

    return filteredRows.slice().sort((left, right) => {
      if (matrixSortMode === "pdd_desc") {
        const pddDifference = right.currentPdd - left.currentPdd;

        if (Math.abs(pddDifference) >= 0.005) {
          return pddDifference;
        }
      }

      return left.name.localeCompare(right.name, "pt-BR");
    });
  }, [dates, matrixSortMode, rows, showOnlyMonthTurnovers]);

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-5 shadow-executive">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-primary">PDD</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              Painel de provisao dos FIDCs
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {summary.fundName} · base {summary.referenceDateLabel}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase text-slate-500">PDD atual</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {formatCurrency(summary.currentPdd)}
              </p>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase text-slate-500">Viradas 7 dias</p>
              <p className="mt-1 text-lg font-semibold text-red-700">
                {formatSignedCurrency(pddDeltaSevenDays)}
              </p>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase text-slate-500">PDD em 15 dias</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {formatCurrency(summary.projectedFifteenDaysPdd)}
              </p>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase text-slate-500">Estoque analisado</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {summary.titleCount.toLocaleString("pt-BR")} titulos
              </p>
              <p className="text-xs text-slate-500">
                {summary.cedentCount} cedentes · {summary.debtorCount} sacados
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Viradas dos proximos 7 dias
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Cedentes e sacados que mudam de faixa pela logica PDD. O valor
                Virada PDD e o delta incremental daquela data.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm">
                <span className="text-slate-600">Viradas 7 dias: </span>
                <span className="font-semibold text-red-700">
                  {formatSignedCurrency(pddDeltaSevenDays)}
                </span>
              </div>
              <button
                className="h-9 rounded border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={() => setIsTurnoversOpen((current) => !current)}
                type="button"
              >
                {isTurnoversOpen ? "Guardar tabela" : "Abrir tabela"}
              </button>
            </div>
          </div>
        </div>

        {isTurnoversOpen && sortedTurnovers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-4 py-3 text-left font-semibold">Data</th>
                  <th className="px-4 py-3 text-left font-semibold">Cedente</th>
                  <th className="px-4 py-3 text-left font-semibold">Sacado</th>
                  <th className="px-4 py-3 text-left font-semibold">Faixa</th>
                  <th className="px-4 py-3 text-right font-semibold">Valor presente</th>
                  <th
                    className="px-4 py-3 text-right font-semibold"
                    title="Delta incremental de PDD gerado nesta data pela mudanca de faixa."
                  >
                    Virada PDD
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedTurnovers.slice(0, 20).map((item) => (
                  <tr
                    className="border-b border-slate-100 last:border-0"
                    key={`${item.date}-${item.cedentName}-${item.debtorName}-${item.value}`}
                  >
                    <td className="px-4 py-3 font-medium text-slate-700">
                      {item.dateLabel}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{item.cedentName}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <span className="block font-medium text-slate-950">
                        {item.debtorName}
                      </span>
                      <span className="text-xs text-slate-500">
                        {compactDocument(item.debtorDocument)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {item.previousRange} para {item.nextRange}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatCurrency(item.presentValue)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-red-700">
                      {formatCurrency(item.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : isTurnoversOpen ? (
          <p className="px-5 py-8 text-sm text-slate-500">
            Nenhuma virada de faixa prevista nos proximos 7 dias.
          </p>
        ) : (
          <p className="px-5 py-4 text-sm text-slate-500">
            Tabela guardada para manter a tela limpa.
          </p>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-executive">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Matriz de PDD por cedente
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Linhas por cedente, explosao por sacado e colunas por data projetada.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <span>Ordenar</span>
                <select
                  className="h-9 rounded border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  onChange={(event) =>
                    setMatrixSortMode(event.target.value as MatrixSortMode)
                  }
                  value={matrixSortMode}
                >
                  <option value="alpha">A-Z</option>
                  <option value="pdd_desc">Maior PDD</option>
                </select>
              </label>
              <label className="flex h-9 items-center gap-2 rounded border border-slate-200 px-3 text-sm font-medium text-slate-700">
                <input
                  checked={showOnlyMonthTurnovers}
                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  onChange={(event) =>
                    setShowOnlyMonthTurnovers(event.target.checked)
                  }
                  type="checkbox"
                />
                Viram no mes
              </label>
              <button
                className="h-9 rounded border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={hasAnyExpansion ? collapseAll : expandAll}
                type="button"
              >
                {hasAnyExpansion ? "Recolher todos" : "Expandir todos"}
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1280px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <th className="sticky left-0 z-30 min-w-[380px] max-w-[380px] border-b border-slate-200 bg-slate-50 px-4 py-3 text-left font-semibold shadow-[10px_0_16px_-16px_rgba(15,23,42,0.45)]">
                  Cedente / Sacado
                </th>
                <th className="border-b border-slate-200 px-4 py-3 text-right font-semibold">Titulos</th>
                <th className="border-b border-slate-200 px-4 py-3 text-right font-semibold">Valor presente</th>
                {dates.map((date) => (
                  <th className="border-b border-slate-200 px-4 py-3 text-right font-semibold" key={date.key}>
                    <span className={date.isBase ? "text-primary" : undefined}>
                      {date.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const isExpanded = expandedCedents.has(row.key);

                return (
                  <Fragment key={row.key}>
                    <tr
                      className="group bg-white hover:bg-slate-50"
                      key={row.key}
                    >
                      <td className="sticky left-0 z-20 min-w-[380px] max-w-[380px] border-b border-slate-100 bg-white px-4 py-3 shadow-[10px_0_16px_-16px_rgba(15,23,42,0.45)] group-hover:bg-slate-50">
                        <button
                          className="flex w-full items-start gap-2 text-left"
                          onClick={() => toggleCedent(row.key)}
                          type="button"
                        >
                          {isExpanded ? (
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          ) : (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-slate-950">
                              {row.name}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {row.debtorCount} sacados · {compactDocument(row.document)}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right text-slate-700">
                        {row.titleCount.toLocaleString("pt-BR")}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 text-right text-slate-700">
                        {formatCurrency(row.presentValue)}
                      </td>
                      {dates.map((date, index) => {
                        const value = row.values[date.key] ?? 0;
                        const previousValue =
                          index > 0 ? row.values[dates[index - 1].key] ?? 0 : value;
                        const changed =
                          index > 0 && Math.abs(value - previousValue) >= 0.005;

                        return (
                          <td className={matrixCellClass(changed)} key={date.key}>
                            <MatrixValue
                              changed={changed}
                              previousValue={previousValue}
                              value={value}
                            />
                          </td>
                        );
                      })}
                    </tr>

                    {isExpanded
                      ? row.debtors.map((debtor) => (
                          <tr
                            className="bg-slate-50"
                            key={`${row.key}-${debtor.key}`}
                          >
                            <td className="sticky left-0 z-20 min-w-[380px] max-w-[380px] border-b border-slate-100 bg-slate-50 px-4 py-3 pl-10 shadow-[10px_0_16px_-16px_rgba(15,23,42,0.45)]">
                              <span className="block truncate font-medium text-slate-800">
                                {debtor.name}
                              </span>
                              <span className="block text-xs text-slate-500">
                                {compactDocument(debtor.document)}
                              </span>
                            </td>
                            <td className="border-b border-slate-100 px-4 py-3 text-right text-slate-600">
                              {debtor.titleCount.toLocaleString("pt-BR")}
                            </td>
                            <td className="border-b border-slate-100 px-4 py-3 text-right text-slate-600">
                              {formatCurrency(debtor.presentValue)}
                            </td>
                            {dates.map((date, index) => {
                              const value = debtor.values[date.key] ?? 0;
                              const previousValue =
                                index > 0
                                  ? debtor.values[dates[index - 1].key] ?? 0
                                  : value;
                              const changed =
                                index > 0 &&
                                Math.abs(value - previousValue) >= 0.005;

                              return (
                                <td className={matrixCellClass(changed)} key={date.key}>
                                  <MatrixValue
                                    changed={changed}
                                    previousValue={previousValue}
                                    value={value}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
